"""Tests for Funnel and ROI Analytics Engine."""

import json
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from src.main import app
from src.models.entities import OpportunityModel, OpportunityScoreModel, ApplicationModel, MessageModel, ProposalModel
from src.analytics.funnel import calculate_funnel
from src.analytics.roi import calculate_roi


@pytest.mark.asyncio
async def test_funnel_calculations(test_db_session: AsyncSession):
    # Setup test data
    opp1 = OpportunityModel(
        fingerprint="fp_ana_1",
        source="upwork_rss",
        url="https://upwork.com/jobs/1",
        title="Spring Boot Senior Engineer",
        description="High-volume enterprise backend development",
        required_skills_json=json.dumps(["Java", "Spring Boot", "PostgreSQL"]),
        budget_max=4000.0,
        application_cost=3.0,
    )
    opp2 = OpportunityModel(
        fingerprint="fp_ana_2",
        source="remoteok",
        url="https://remoteok.com/jobs/2",
        title="Android Developer needed for ClothMatics extension",
        description="Native Android Kotlin and Play Store publishing",
        required_skills_json=json.dumps(["Android", "Kotlin", "Google Play"]),
        budget_max=2500.0,
        application_cost=0.0,
    )
    opp3 = OpportunityModel(
        fingerprint="fp_ana_3",
        source="reddit",
        url="https://reddit.com/r/forhire/3",
        title="WordPress Blog Setup",
        description="Install theme and basic plugins",
        required_skills_json=json.dumps(["WordPress", "PHP"]),
        budget_max=100.0,
        application_cost=0.0,
    )
    test_db_session.add_all([opp1, opp2, opp3])
    await test_db_session.flush()

    # Scores: opp1 qualified (0.90, APPLY), opp2 qualified (0.80, REVIEW), opp3 not qualified (0.25, SKIP)
    score1 = OpportunityScoreModel(
        opportunity_id=opp1.id,
        fit_score=0.90,
        technical_match=0.95,
        portfolio_match=0.90,
        client_quality=0.85,
        value_score=0.80,
        competition_score=0.70,
        risk_score=0.10,
        recommended_action="APPLY",
        reasoning_json="[]",
        recommended_portfolio_ids_json="[]",
        recommended_strategy="solution_first",
    )
    score2 = OpportunityScoreModel(
        opportunity_id=opp2.id,
        fit_score=0.80,
        technical_match=0.85,
        portfolio_match=0.85,
        client_quality=0.75,
        value_score=0.75,
        competition_score=0.60,
        risk_score=0.15,
        recommended_action="REVIEW",
        reasoning_json="[]",
        recommended_portfolio_ids_json="[]",
        recommended_strategy="solution_first",
    )
    score3 = OpportunityScoreModel(
        opportunity_id=opp3.id,
        fit_score=0.25,
        technical_match=0.10,
        portfolio_match=0.00,
        client_quality=0.50,
        value_score=0.30,
        competition_score=0.20,
        risk_score=0.60,
        recommended_action="SKIP",
        reasoning_json="[]",
        recommended_portfolio_ids_json="[]",
        recommended_strategy="solution_first",
    )
    test_db_session.add_all([score1, score2, score3])
    await test_db_session.flush()

    # Applications:
    # app1 submitted
    # app2 won
    app1 = ApplicationModel(
        opportunity_id=opp1.id,
        status="submitted",
        proposed_price=3800.0,
    )
    app2 = ApplicationModel(
        opportunity_id=opp2.id,
        status="won",
        proposed_price=2500.0,
        actual_revenue=2500.0,
    )
    test_db_session.add_all([app1, app2])
    await test_db_session.flush()

    # Messages:
    # app1 has a client question
    # app2 has a client interview
    msg1 = MessageModel(
        application_id=app1.id,
        sender="client",
        text="Can you describe your experience with high throughput Java services?",
        intent="QUESTION",
    )
    msg2 = MessageModel(
        application_id=app2.id,
        sender="client",
        text="We love your ClothMatics Play Store app. When can we do a 15-min technical interview call?",
        intent="INTERVIEW",
    )
    test_db_session.add_all([msg1, msg2])
    await test_db_session.commit()

    report = await calculate_funnel(test_db_session)

    assert report.total_discovered == 3
    assert report.qualified == 2  # opp1 and opp2
    assert report.applied == 2  # app1 (submitted) and app2 (won)
    assert report.replied == 2  # app1 and app2 received client messages
    assert report.interview == 1  # app2 had INTERVIEW message
    assert report.won == 1  # app2 won
    assert report.overall_conversion_rate == round(1 / 3, 4)

    # Check stage breakdown
    stage_map = {s.stage: s for s in report.stages}
    assert stage_map["Discovered"].count == 3
    assert stage_map["Qualified"].count == 2
    assert stage_map["Applied"].count == 2
    assert stage_map["Replied"].count == 2
    assert stage_map["Interview"].count == 1
    assert stage_map["Won"].count == 1


@pytest.mark.asyncio
async def test_roi_and_platform_breakdown(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_ana_roi_1",
        source="upwork_rss",
        url="https://upwork.com/jobs/roi1",
        title="Enterprise Spring Boot Migration",
        description="Migrate monolith to microservices using Java Spring Boot",
        required_skills_json=json.dumps(["Java", "Spring Boot", "Microservices"]),
        budget_max=5000.0,
        application_cost=4.0,  # $4 cost
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_won = ApplicationModel(
        opportunity_id=opp.id,
        status="won",
        proposed_price=5000.0,
        actual_revenue=5000.0,
    )
    test_db_session.add(app_won)
    await test_db_session.flush()

    msg = MessageModel(
        application_id=app_won.id,
        sender="client",
        text="Congratulations, you got the contract!",
        intent="INTERESTED",
    )
    test_db_session.add(msg)
    await test_db_session.commit()

    roi_report = await calculate_roi(test_db_session)

    assert roi_report.total_spend_usd == 4.0
    assert roi_report.total_spend_inr == 4.0 * 85.0
    assert roi_report.won_revenue_usd == 5000.0
    assert roi_report.net_profit_usd == 4996.0
    assert roi_report.overall_roi_percent > 100.0

    # Source breakdown
    upwork_stat = next(p for p in roi_report.platform_breakdown if p.source_id == "upwork_rss")
    assert upwork_stat.opportunities_count == 1
    assert upwork_stat.applications_count == 1
    assert upwork_stat.wins_count == 1
    assert upwork_stat.win_rate == 1.0
    assert upwork_stat.won_revenue_usd == 5000.0

    # Tech breakdown
    java_stat = next(t for t in roi_report.tech_breakdown if "Java" in t.tech)
    assert java_stat.opportunities_count == 1
    assert java_stat.wins_count == 1
    assert java_stat.revenue_usd == 5000.0


@pytest.mark.asyncio
async def test_analytics_api_endpoints():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res_funnel = await ac.get("/api/analytics/funnel")
        assert res_funnel.status_code == 200
        data_f = res_funnel.json()
        assert "total_discovered" in data_f
        assert "stages" in data_f
        assert len(data_f["stages"]) == 6

        res_roi = await ac.get("/api/analytics/roi")
        assert res_roi.status_code == 200
        data_r = res_roi.json()
        assert "total_spend_usd" in data_r
        assert "total_spend_inr" in data_r
        assert "won_revenue_usd" in data_r
        assert "platform_breakdown" in data_r
        assert "tech_breakdown" in data_r
