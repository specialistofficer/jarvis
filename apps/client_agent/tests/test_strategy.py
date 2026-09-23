"""Tests for A/B Testing, Strategy Learning, and Periodic Reviews."""

import json
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from src.main import app
from src.models.entities import OpportunityModel, ApplicationModel, ProposalModel, MessageModel
from src.strategy.experiments import (
    assign_variant,
    evaluate_proposal_style_experiment,
    generate_strategy_review,
)


def test_assign_variant_determinism():
    # Same inputs must produce same variant
    v1 = assign_variant("exp_proposal_style", "opp-12345")
    v2 = assign_variant("exp_proposal_style", "opp-12345")
    assert v1 == v2
    assert v1 in ["solution_first", "portfolio_first", "concise"]

    # Different inputs explore different variants
    variants = {assign_variant("exp_proposal_style", f"opp-{i}") for i in range(50)}
    assert len(variants) > 1  # Should hit multiple variants across 50 keys


@pytest.mark.asyncio
async def test_proposal_style_experiment_evaluation(test_db_session: AsyncSession):
    # Opp 1: solution_first (won)
    opp1 = OpportunityModel(
        fingerprint="fp_strat_1",
        source="remoteok",
        url="https://remoteok.com/job/strat1",
        title="Full Stack Spring React Engineer",
        description="Senior enterprise developer needed",
        required_skills_json=json.dumps(["Java", "React"]),
    )
    # Opp 2: portfolio_first (applied, no reply)
    opp2 = OpportunityModel(
        fingerprint="fp_strat_2",
        source="upwork_rss",
        url="https://upwork.com/jobs/strat2",
        title="Android Consultant",
        description="Mobile Kotlin developer needed",
        required_skills_json=json.dumps(["Android"]),
    )
    test_db_session.add_all([opp1, opp2])
    await test_db_session.flush()

    app1 = ApplicationModel(opportunity_id=opp1.id, status="won", proposed_price=3000.0)
    app2 = ApplicationModel(opportunity_id=opp2.id, status="submitted", proposed_price=1500.0)
    test_db_session.add_all([app1, app2])
    await test_db_session.flush()

    prop1 = ProposalModel(
        application_id=app1.id,
        cover_letter="Problem-first solution approach...",
        strategy="solution_first",
        is_factually_verified=True,
    )
    prop2 = ProposalModel(
        application_id=app2.id,
        cover_letter="Here is my portfolio...",
        strategy="portfolio_first",
        is_factually_verified=True,
    )
    msg1 = MessageModel(
        application_id=app1.id,
        sender="client",
        text="Loved the solution overview!",
        intent="INTERESTED",
    )
    test_db_session.add_all([prop1, prop2, msg1])
    await test_db_session.commit()

    report = await evaluate_proposal_style_experiment(test_db_session)

    assert report.experiment_id == "exp_proposal_style"
    assert len(report.variants) == 3

    sol_var = next(v for v in report.variants if v.name == "solution_first")
    assert sol_var.applications_count == 1
    assert sol_var.replies_count == 1
    assert sol_var.wins_count == 1
    assert sol_var.win_rate == 1.0

    port_var = next(v for v in report.variants if v.name == "portfolio_first")
    assert port_var.applications_count == 1
    assert port_var.replies_count == 0
    assert port_var.wins_count == 0


@pytest.mark.asyncio
async def test_strategy_review_generation(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_strat_review_1",
        source="remoteok",
        url="https://remoteok.com/job/strat_rev",
        title="High Performance Java Microservices",
        description="Spring Boot microservices architect needed",
        required_skills_json=json.dumps(["Java", "Spring Boot"]),
        application_cost=0.0,
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app = ApplicationModel(opportunity_id=opp.id, status="won", proposed_price=4500.0)
    test_db_session.add(app)
    await test_db_session.flush()

    review = await generate_strategy_review(test_db_session)

    assert len(review.active_experiments) >= 1
    assert "remoteok" in review.top_performing_sources
    assert len(review.strategic_recommendations) >= 1


@pytest.mark.asyncio
async def test_strategy_api_endpoints():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res_exp = await ac.get("/api/strategy/experiments")
        assert res_exp.status_code == 200
        data_exp = res_exp.json()
        assert isinstance(data_exp, list)
        assert len(data_exp) >= 1
        assert data_exp[0]["experiment_id"] == "exp_proposal_style"

        res_rev = await ac.post("/api/strategy/review")
        assert res_rev.status_code == 200
        data_rev = res_rev.json()
        assert "strategic_recommendations" in data_rev
        assert "top_performing_sources" in data_rev
