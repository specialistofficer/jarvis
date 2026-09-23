"""
Tests for Opportunity Intelligence, Multi-Factor Scoring, and Application Economics.
"""
import pytest
import json
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from httpx import AsyncClient, ASGITransport

from src.economics.calculator import ApplicationEconomicsCalculator, UPWORK_CONNECT_COST_USD
from src.intelligence.scoring import OpportunityScorer
from src.intelligence.agent import OpportunityIntelligenceAgent
from src.models.entities import OpportunityModel, OpportunityScoreModel, AuditLogModel
from src.models.schemas import OpportunityScoreResult, EconomicsEvaluationSchema
from src.main import app


# ---------------------------------------------------------
# Economics Calculator Unit Tests
# ---------------------------------------------------------

def test_economics_cost_calculation():
    calc = ApplicationEconomicsCalculator(allow_paid_spend=False, max_cost_inr=0.0, usd_to_inr=85.0)

    # Free platforms
    cost_usd, cost_inr = calc.calculate_cost("remoteok")
    assert cost_usd == 0.0
    assert cost_inr == 0.0

    cost_usd, cost_inr = calc.calculate_cost("hackernews")
    assert cost_usd == 0.0

    cost_usd, cost_inr = calc.calculate_cost("reddit")
    assert cost_usd == 0.0

    # Upwork connects
    cost_usd, cost_inr = calc.calculate_cost("upwork", connects=16)
    assert cost_usd == round(16 * UPWORK_CONNECT_COST_USD, 2)  # $2.40
    assert cost_inr == round(2.40 * 85.0, 2)  # ₹204.00


def test_economics_platform_fee_rates():
    calc = ApplicationEconomicsCalculator()
    assert calc.get_platform_fee_rate("upwork") == 0.10
    assert calc.get_platform_fee_rate("freelancer") == 0.10
    assert calc.get_platform_fee_rate("remoteok") == 0.0
    assert calc.get_platform_fee_rate("hackernews") == 0.0
    assert calc.get_platform_fee_rate("reddit") == 0.0


def test_economics_spend_guard_enforcement():
    # Strict spend lock: ALLOW_PAID_SPEND = False
    strict_calc = ApplicationEconomicsCalculator(allow_paid_spend=False, max_cost_inr=0.0)
    eval_strict = strict_calc.evaluate(
        source="upwork",
        budget_min=500.0,
        budget_max=1000.0,
        fit_score=85.0,
        connects=16,
    )
    assert eval_strict.is_spend_permitted is False
    assert eval_strict.application_cost_usd > 0.0
    assert eval_strict.recommendation == "REVIEW"  # Blocked from auto-apply
    assert any("ALLOW_PAID_SPEND=False" in r for r in eval_strict.reasons)

    # Permitted spend: ALLOW_PAID_SPEND = True, MAX_COST_INR = 500
    allowed_calc = ApplicationEconomicsCalculator(allow_paid_spend=True, max_cost_inr=500.0)
    eval_allowed = allowed_calc.evaluate(
        source="upwork",
        budget_min=1000.0,
        budget_max=2000.0,
        fit_score=85.0,
        connects=8,
    )
    assert eval_allowed.is_spend_permitted is True
    assert eval_allowed.recommendation == "APPLY"


def test_economics_ev_and_win_probability():
    calc = ApplicationEconomicsCalculator()

    # Win prob bounds
    p_high = calc.estimate_win_probability(fit_score=95.0, competition_score=80.0, client_quality=90.0, has_matching_portfolio=True)
    assert 0.01 <= p_high <= 0.50
    assert p_high >= 0.30

    p_low = calc.estimate_win_probability(fit_score=20.0, competition_score=20.0, client_quality=20.0, has_matching_portfolio=False)
    assert 0.01 <= p_low <= 0.15

    # EV calculation for low-budget gig
    eval_micro = calc.evaluate(
        source="remoteok",
        budget_min=20.0,
        budget_max=25.0,
        fit_score=80.0,
    )
    assert eval_micro.recommendation == "SKIP"
    assert any("below minimum viable threshold" in r for r in eval_micro.reasons)


# ---------------------------------------------------------
# Opportunity Scorer Unit Tests
# ---------------------------------------------------------

def test_scorer_high_match_java_spring_react():
    scorer = OpportunityScorer()
    title = "Senior Full-Stack Engineer (Java, Spring Boot, React)"
    desc = "Looking for an engineer to architect REST APIs with Spring Boot and build a modern React dashboard."

    tech_score, matched, missing, reasons = scorer.calculate_technical_match(
        required_skills=["Java", "Spring Boot", "React", "REST API"],
        title=title,
        description=desc,
    )
    assert tech_score >= 80.0
    assert "Java" in matched
    assert "React" in matched

    port_score, slugs, port_reasons = scorer.calculate_portfolio_match(
        required_skills=["Java", "Spring Boot", "React"],
        title=title,
        description=desc,
    )
    assert port_score >= 70.0
    assert "enterprise-financial-core" in slugs

    strategy = scorer.determine_strategy(tech_score, slugs, title, desc)
    assert strategy == "enterprise_architecture_first"

    fit = scorer.calculate_fit_score(
        technical_match=tech_score,
        portfolio_match=port_score,
        client_quality=80.0,
        value_score=85.0,
        competition_score=70.0,
        risk_score=0.0,
    )
    assert fit >= 75.0


def test_scorer_android_play_store_match():
    scorer = OpportunityScorer()
    title = "Optimize production Android App for Google Play Store"
    desc = "Need experienced Android and React Native engineer to optimize app performance and release on Play Store."

    port_score, slugs, reasons = scorer.calculate_portfolio_match(
        required_skills=["Android", "React Native", "Google Play"],
        title=title,
        description=desc,
    )
    assert "clothmatics-ai" in slugs
    assert port_score >= 80.0

    strategy = scorer.determine_strategy(80.0, slugs, title, desc)
    assert strategy == "live_app_case_study"


def test_scorer_incompatible_tech_penalty():
    scorer = OpportunityScorer()
    title = "WordPress / WooCommerce Developer for PHP Theme Customization"
    desc = "Need PHP expert to modify WordPress plugin and WooCommerce checkout."

    tech_score, matched, missing, reasons = scorer.calculate_technical_match(
        required_skills=["WordPress", "PHP", "WooCommerce"],
        title=title,
        description=desc,
    )
    assert tech_score <= 25.0
    assert any("Incompatible technology" in r for r in reasons)


def test_scorer_risk_detection():
    scorer = OpportunityScorer()
    title = "Urgent: Build full SaaS MVP in 24 hours, work for equity"
    desc = "Unpaid equity-only opportunity. Contact me on Telegram @scammer123 to complete a free test task first."

    risk_score, red_flags = scorer.calculate_risk_score(
        title=title,
        description=desc,
        budget_max=0.0,
        client_rating=2.5,
    )
    assert risk_score >= 70.0
    assert len(red_flags) >= 2
    assert any("Equity or unpaid" in f for f in red_flags)
    assert any("off-platform contact" in f for f in red_flags)


# ---------------------------------------------------------
# Opportunity Intelligence Agent Integration Tests
# ---------------------------------------------------------

@pytest.mark.asyncio
async def test_intelligence_agent_evaluate_and_persist(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_test_intel_1",
        source="remoteok",
        title="Full Stack Java & React Engineer",
        description="Senior engineer needed for microservices and React web portal. Budget $2500.",
        url="https://remoteok.com/job/test1",
        client_name="Fintech Solutions",
        client_country="United States",
        client_spend=15000.0,
        client_rating=4.9,
        budget_min=2000.0,
        budget_max=3000.0,
        currency="USD",
        required_skills_json=json.dumps(["Java", "Spring Boot", "React", "SQL"]),
        application_cost=0.0,
        status="discovered",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    agent = OpportunityIntelligenceAgent()
    result = await agent.evaluate_opportunity(opp, session=test_db_session)

    assert isinstance(result, OpportunityScoreResult)
    assert result.fit_score >= 70.0
    assert result.technical_match >= 75.0
    assert result.recommended_action == "APPLY"
    assert "enterprise-financial-core" in result.recommended_portfolio_slugs
    assert result.economics is not None
    assert result.economics.expected_monetary_value > 100.0

    # Verify DB persistence
    score_stmt = select(OpportunityScoreModel).where(OpportunityScoreModel.opportunity_id == opp.id)
    score_res = await test_db_session.execute(score_stmt)
    saved_score = score_res.scalars().first()
    assert saved_score is not None
    assert saved_score.fit_score == result.fit_score
    assert saved_score.recommended_action == "APPLY"

    # Verify status changed from "discovered" to "qualified"
    opp_stmt = select(OpportunityModel).where(OpportunityModel.id == opp.id)
    opp_res = await test_db_session.execute(opp_stmt)
    updated_opp = opp_res.scalars().first()
    assert updated_opp.status == "qualified"

    # Verify audit event recorded
    audit_stmt = select(AuditLogModel).where(
        AuditLogModel.event_type == "opportunity_scored",
        AuditLogModel.entity_id == opp.id,
    )
    audit_res = await test_db_session.execute(audit_stmt)
    audit = audit_res.scalars().first()
    assert audit is not None


@pytest.mark.asyncio
async def test_intelligence_agent_skip_incompatible_opportunity(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_test_incompatible_1",
        source="upwork",
        title="WordPress theme bug fixes",
        description="Fix PHP and WordPress theme styles. Cheap $15 job.",
        url="https://upwork.com/job/test2",
        budget_min=10.0,
        budget_max=15.0,
        required_skills_json=json.dumps(["WordPress", "PHP"]),
        application_cost=1.20,
        status="discovered",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    agent = OpportunityIntelligenceAgent()
    result = await agent.evaluate_opportunity(opp, session=test_db_session)

    assert result.recommended_action == "SKIP"
    assert opp.status == "rejected"


# ---------------------------------------------------------
# FastAPI Endpoints Tests
# ---------------------------------------------------------

@pytest.mark.asyncio
async def test_api_score_opportunity_endpoint(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_api_score_1",
        source="remoteok",
        title="Senior React & TypeScript Developer",
        description="Build responsive UI dashboards with React, Next.js and TypeScript.",
        url="https://remoteok.com/job/api1",
        budget_min=1500.0,
        budget_max=2500.0,
        required_skills_json=json.dumps(["React", "TypeScript"]),
        status="discovered",
    )
    test_db_session.add(opp)
    await test_db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # POST score
        resp = await client.post(f"/api/opportunities/{opp.id}/score")
        assert resp.status_code == 200
        data = resp.json()
        assert "fit_score" in data
        assert "technical_match" in data
        assert "recommended_action" in data
        assert data["fit_score"] >= 60.0

        # GET score
        get_resp = await client.get(f"/api/opportunities/{opp.id}/score")
        assert get_resp.status_code == 200
        get_data = get_resp.json()
        assert get_data["opportunity_id"] == opp.id
        assert get_data["fit_score"] == data["fit_score"]

        # 404 for unknown ID
        unknown_resp = await client.post("/api/opportunities/non-existent-id/score")
        assert unknown_resp.status_code == 404


@pytest.mark.asyncio
async def test_api_score_batch_endpoint(test_db_session: AsyncSession):
    opp1 = OpportunityModel(
        fingerprint="fp_batch_1",
        source="remoteok",
        title="Spring Boot Microservices Architect",
        description="Enterprise Java and Spring Boot cloud services.",
        url="https://remoteok.com/job/b1",
        status="discovered",
    )
    opp2 = OpportunityModel(
        fingerprint="fp_batch_2",
        source="remoteok",
        title="React Frontend Engineer",
        description="React UI dashboard engineer.",
        url="https://remoteok.com/job/b2",
        status="discovered",
    )
    test_db_session.add_all([opp1, opp2])
    await test_db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post("/api/opportunities/score-batch", json={"limit": 10})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 2
        for item in data:
            assert "fit_score" in item
            assert item["recommended_action"] in ["APPLY", "REVIEW", "SKIP"]
