"""
Proposal Generation Agent.
Synthesizes verified owner profile, factual portfolio, and opportunity requirements
to draft problem-first, hyper-personalized proposals that pass strict factual verification.
"""
import json
from typing import List, Optional, Tuple, Dict, Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.ai.provider import get_ai_provider
from src.ai.base import AIProvider
from src.models.entities import OpportunityModel, OpportunityScoreModel, ApplicationModel, ProposalModel
from src.models.schemas import ProposalDraftSchema, FactualVerificationReport
from src.profile.service import match_portfolio_items, get_owner_profile
from src.profile.owner_data import PORTFOLIO_ITEMS, VERIFIED_SKILLS
from src.proposals.validator import FactualVerificationGuard
from src.audit.logger import record_audit_event


class ProposalGenerationAgent:
    """Orchestrates compliant, factual proposal drafting and validation."""

    def __init__(
        self,
        ai_provider: Optional[AIProvider] = None,
        validator: Optional[FactualVerificationGuard] = None,
    ):
        self.ai_provider = ai_provider or get_ai_provider()
        self.validator = validator or FactualVerificationGuard()

    def _generate_template_proposal(
        self,
        opp: OpportunityModel,
        strategy: str,
        matched_slugs: List[str],
        proposed_price: Optional[float],
    ) -> str:
        """
        Deterministic, problem-first proposal generator compliant with zero-hallucination rules.
        """
        portfolio_refs = []
        for slug in matched_slugs:
            for item in PORTFOLIO_ITEMS:
                if item.slug == slug:
                    ref = f"- {item.name} ({item.industry}): {item.problem_solved}"
                    if item.play_store_url:
                        ref += f" (Live Play Store: {item.play_store_url})"
                    elif item.github_url:
                        ref += f" (Repository: {item.github_url})"
                    portfolio_refs.append(ref)

        portfolio_section = "\n".join(portfolio_refs) if portfolio_refs else "- 10-year enterprise track record with Java, Spring Boot, React, and Android."

        if strategy == "live_app_case_study":
            opening = f"I reviewed your requirements for '{opp.title}'. App performance and production stability on the Google Play Store require clean native integration, proper threading, and optimized asset handling."
            approach = "1. Diagnostic audit of current bundle size, UI rendering frame drops, and background memory consumption.\n2. Implementation of optimized React Native / Android native components with zero memory leaks.\n3. Release preparation, Play Console compliance checks, and staged rollout verification."
        elif strategy == "enterprise_architecture_first":
            opening = f"Regarding '{opp.title}', building scalable, secure backend systems requires robust API contract design, resilient database transactions, and clean separation of concerns."
            approach = "1. Design clear REST API schemas and asynchronous services using Spring Boot and Java.\n2. Database indexing, connection pool tuning, and transaction management (Oracle/PostgreSQL/SQL).\n3. End-to-end integration tests and clean Swagger/OpenAPI documentation for seamless frontend integration."
        elif strategy == "solution_demo_first":
            opening = f"I analyzed your requirements for '{opp.title}'. Automated workflows and AI integrations succeed when they incorporate reliable fallback handling and structured outputs."
            approach = "1. Architect resilient pipeline with FastAPI and Google Gemini SDK for structured data extraction.\n2. Add rate limiting, retries, and schema validation to guarantee reliable output.\n3. Deliver clean, modular code with complete automated test coverage."
        else:
            opening = f"Regarding your project '{opp.title}', the priority is delivering a clean, robust solution that directly solves the core bottleneck without unnecessary technical bloat."
            approach = "1. Analyze exact scope and outline clear technical deliverables.\n2. Implement modular full-stack components (React UI + REST API backend).\n3. Thorough testing, automated checks, and responsive deployment support."

        bid_line = f"Proposed Budget: ${proposed_price:,.0f} USD" if proposed_price else "Open to milestone-based pricing based on confirmed scope."

        proposal = f"""Hi,

{opening}

Technical Plan:
{approach}

Relevant Production Experience:
{portfolio_section}

I bring 10 years of hands-on software development experience across enterprise Java/Spring backends, modern React web applications, and live Google Play Android apps.

{bid_line}
Happy to discuss details and get started promptly.

Best regards,
Chirag"""
        return proposal.strip()

    async def generate_proposal(
        self,
        opportunity_id: str,
        session: AsyncSession,
        custom_strategy: Optional[str] = None,
        custom_price: Optional[float] = None,
    ) -> Tuple[ProposalModel, FactualVerificationReport]:
        """
        Generate, verify, and store a proposal for an opportunity.
        """
        # Fetch opportunity
        opp_stmt = select(OpportunityModel).where(OpportunityModel.id == opportunity_id).limit(1)
        opp_res = await session.execute(opp_stmt)
        opp = opp_res.scalars().first()
        if not opp:
            raise ValueError(f"Opportunity {opportunity_id} not found")

        # Fetch score if available
        score_stmt = select(OpportunityScoreModel).where(OpportunityScoreModel.opportunity_id == opportunity_id).limit(1)
        score_res = await session.execute(score_stmt)
        score = score_res.scalars().first()

        strategy = custom_strategy or (score.recommended_strategy if score else "solution_first")
        try:
            matched_slugs = json.loads(score.recommended_portfolio_ids_json) if score else []
        except Exception:
            matched_slugs = []

        if not matched_slugs:
            # Fallback match
            try:
                req_skills = json.loads(opp.required_skills_json) if opp.required_skills_json else []
            except Exception:
                req_skills = []
            matched_items = match_portfolio_items(req_skills, max_items=2)
            matched_slugs = [item.slug for item in matched_items]

        # Determine price
        proposed_price = custom_price or opp.budget_max or opp.budget_min

        # Generate proposal text
        cover_letter = self._generate_template_proposal(
            opp=opp,
            strategy=strategy,
            matched_slugs=matched_slugs,
            proposed_price=proposed_price,
        )

        # Factual verification audit
        verification_report = self.validator.verify_proposal(cover_letter)

        # Fetch or create application record
        app_stmt = select(ApplicationModel).where(ApplicationModel.opportunity_id == opportunity_id).limit(1)
        app_res = await session.execute(app_stmt)
        application = app_res.scalars().first()

        if not application:
            application = ApplicationModel(
                opportunity_id=opportunity_id,
                status="pending_approval" if settings.DEFAULT_APPLICATION_MODE == "APPROVAL_REQUIRED" else "draft",
                mode=settings.DEFAULT_APPLICATION_MODE,
                proposed_price=proposed_price,
                submission_url=opp.url,
            )
            session.add(application)
            await session.flush()
        else:
            application.proposed_price = proposed_price
            application.status = "pending_approval"

        # Create proposal record
        proposal = ProposalModel(
            application_id=application.id,
            version=1,
            cover_letter=cover_letter,
            strategy=strategy,
            portfolio_item_ids_json=json.dumps(matched_slugs),
            is_factually_verified=verification_report.is_valid,
            verification_report_json=verification_report.model_dump_json(),
        )
        session.add(proposal)
        await session.flush()

        # Audit log
        await record_audit_event(
            session=session,
            event_type="proposal_generated",
            entity_type="proposal",
            entity_id=proposal.id,
            details={
                "opportunity_id": opportunity_id,
                "strategy": strategy,
                "is_verified": verification_report.is_valid,
                "portfolio_items": matched_slugs,
                "price": proposed_price,
            },
        )
        await session.commit()

        return proposal, verification_report
