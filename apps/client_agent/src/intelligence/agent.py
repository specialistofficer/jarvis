"""
Opportunity Intelligence Agent Orchestrator.
Evaluates opportunities using multi-factor scoring and economics,
persisting transparent scores and audit trails in the database.
"""
import json
from typing import List, Optional, Dict, Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.entities import OpportunityModel, OpportunityScoreModel
from src.models.schemas import OpportunityScoreResult, OpportunityCreateSchema
from src.intelligence.scoring import OpportunityScorer
from src.economics.calculator import ApplicationEconomicsCalculator
from src.audit.logger import record_audit_event


class OpportunityIntelligenceAgent:
    """
    Coordinates deep evaluation of freelance opportunities,
    synthesizing technical matching, portfolio relevance, economics, and risk.
    """

    def __init__(
        self,
        scorer: Optional[OpportunityScorer] = None,
        economics_calculator: Optional[ApplicationEconomicsCalculator] = None,
    ):
        self.scorer = scorer or OpportunityScorer()
        self.economics = economics_calculator or ApplicationEconomicsCalculator()

    async def evaluate_opportunity(
        self,
        opp: OpportunityModel,
        session: Optional[AsyncSession] = None,
    ) -> OpportunityScoreResult:
        """
        Evaluate an opportunity and optionally persist the score and status in DB.
        """
        # Parse required skills from JSON or text
        try:
            req_skills = json.loads(opp.required_skills_json) if opp.required_skills_json else []
        except Exception:
            req_skills = []

        # 1. Technical match
        tech_score, matched_skills, missing_skills, tech_reasons = (
            self.scorer.calculate_technical_match(
                required_skills=req_skills,
                title=opp.title,
                description=opp.description,
            )
        )

        # 2. Portfolio match
        portfolio_score, portfolio_slugs, portfolio_reasons = (
            self.scorer.calculate_portfolio_match(
                required_skills=req_skills,
                title=opp.title,
                description=opp.description,
            )
        )

        # 3. Client quality
        client_score, client_reasons = self.scorer.calculate_client_quality(
            client_name=opp.client_name,
            client_country=opp.client_country,
            client_spend=opp.client_spend,
            client_rating=opp.client_rating,
            description=opp.description,
        )

        # 4. Value score
        value_score, value_reasons = self.scorer.calculate_value_score(
            budget_min=opp.budget_min,
            budget_max=opp.budget_max,
            currency=opp.currency,
        )

        # 5. Competition score
        competition_score, comp_reasons = self.scorer.calculate_competition_score(
            source=opp.source,
            posted_at=opp.posted_at,
        )

        # 6. Risk score
        risk_score, risk_reasons = self.scorer.calculate_risk_score(
            title=opp.title,
            description=opp.description,
            budget_max=opp.budget_max,
            client_rating=opp.client_rating,
        )

        # 7. Aggregate fit score
        fit_score = self.scorer.calculate_fit_score(
            technical_match=tech_score,
            portfolio_match=portfolio_score,
            client_quality=client_score,
            value_score=value_score,
            competition_score=competition_score,
            risk_score=risk_score,
        )

        # 8. Strategy determination
        strategy = self.scorer.determine_strategy(
            technical_match=tech_score,
            portfolio_slugs=portfolio_slugs,
            title=opp.title,
            description=opp.description,
        )

        # 9. Application Economics evaluation
        econ_eval = self.economics.evaluate(
            source=opp.source,
            budget_min=opp.budget_min,
            budget_max=opp.budget_max,
            fit_score=fit_score,
            competition_score=competition_score,
            client_quality=client_score,
            risk_score=risk_score,
            has_matching_portfolio=(len(portfolio_slugs) > 0),
            explicit_cost_usd=opp.application_cost,
        )

        # 10. Consolidate reasoning
        all_reasons: List[str] = (
            tech_reasons + portfolio_reasons + client_reasons +
            value_reasons + comp_reasons + risk_reasons + econ_eval.reasons
        )

        # 11. Final Recommended Action Policy
        if risk_score >= 60.0 or econ_eval.recommendation == "SKIP" or fit_score < 45.0:
            recommended_action = "SKIP"
        elif not econ_eval.is_spend_permitted and econ_eval.application_cost_usd > 0:
            # Requires human approval for paid spend
            recommended_action = "REVIEW"
        elif fit_score >= 68.0 and econ_eval.recommendation == "APPLY" and risk_score < 35.0:
            recommended_action = "APPLY"
        else:
            recommended_action = "REVIEW"

        result = OpportunityScoreResult(
            fit_score=fit_score,
            technical_match=tech_score,
            portfolio_match=portfolio_score,
            client_quality=client_score,
            value_score=value_score,
            competition_score=competition_score,
            risk_score=risk_score,
            application_cost=econ_eval.application_cost_usd,
            recommended_action=recommended_action,
            reasoning=all_reasons,
            recommended_portfolio_slugs=portfolio_slugs,
            recommended_strategy=strategy,
            economics=econ_eval,
        )

        # Persist to database if session provided
        if session is not None:
            # Check if existing score exists
            score_stmt = select(OpportunityScoreModel).where(
                OpportunityScoreModel.opportunity_id == opp.id
            ).limit(1)
            score_res = await session.execute(score_stmt)
            existing_score = score_res.scalars().first()

            if existing_score:
                existing_score.fit_score = fit_score
                existing_score.technical_match = tech_score
                existing_score.portfolio_match = portfolio_score
                existing_score.client_quality = client_score
                existing_score.value_score = value_score
                existing_score.competition_score = competition_score
                existing_score.risk_score = risk_score
                existing_score.recommended_action = recommended_action
                existing_score.reasoning_json = json.dumps(all_reasons)
                existing_score.recommended_portfolio_ids_json = json.dumps(portfolio_slugs)
                existing_score.recommended_strategy = strategy
            else:
                new_score = OpportunityScoreModel(
                    opportunity_id=opp.id,
                    fit_score=fit_score,
                    technical_match=tech_score,
                    portfolio_match=portfolio_score,
                    client_quality=client_score,
                    value_score=value_score,
                    competition_score=competition_score,
                    risk_score=risk_score,
                    recommended_action=recommended_action,
                    reasoning_json = json.dumps(all_reasons),
                    recommended_portfolio_ids_json = json.dumps(portfolio_slugs),
                    recommended_strategy = strategy,
                )
                session.add(new_score)

            # Update opportunity status
            if recommended_action == "APPLY":
                opp.status = "qualified"
            elif recommended_action == "REVIEW":
                opp.status = "review_needed"
            else:
                opp.status = "rejected"

            await record_audit_event(
                session=session,
                event_type="opportunity_scored",
                entity_type="opportunity",
                entity_id=opp.id,
                details={
                    "fit_score": fit_score,
                    "action": recommended_action,
                    "tech_match": tech_score,
                    "portfolio_match": portfolio_score,
                    "ev": econ_eval.expected_monetary_value,
                    "strategy": strategy,
                },
            )
            await session.commit()

        return result

    async def score_pending_opportunities(
        self,
        session: AsyncSession,
        limit: int = 25,
    ) -> List[OpportunityScoreResult]:
        """Score unscored opportunities with status 'discovered'."""
        stmt = (
            select(OpportunityModel)
            .where(OpportunityModel.status == "discovered")
            .limit(limit)
        )
        res = await session.execute(stmt)
        pending = res.scalars().all()

        scored_results: List[OpportunityScoreResult] = []
        for opp in pending:
            score_res = await self.evaluate_opportunity(opp, session=session)
            scored_results.append(score_res)

        return scored_results
