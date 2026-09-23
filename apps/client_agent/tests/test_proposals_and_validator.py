"""
Tests for Proposal Generation Agent and Factual Verification Guard.
Verifies the mandatory Zero Factual Invention policy.
"""
import pytest
import json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from httpx import AsyncClient, ASGITransport

from src.proposals.validator import FactualVerificationGuard
from src.proposals.agent import ProposalGenerationAgent
from src.models.entities import OpportunityModel, ApplicationModel, ProposalModel, AuditLogModel
from src.models.schemas import FactualVerificationReport
from src.main import app


# ---------------------------------------------------------
# Factual Verification Guard Unit Tests
# ---------------------------------------------------------

def test_factual_guard_blocks_unlisted_technologies():
    guard = FactualVerificationGuard()
    bad_proposal = """
    Hi, I saw your post. I am an experienced Rust and Solidity engineer who builds DeFi smart contracts.
    I can also write your backend in Ruby on Rails and Flutter for mobile.
    """
    report = guard.verify_proposal(bad_proposal)
    assert report.is_valid is False
    assert len(report.unlisted_technologies) >= 2
    assert any("rust" in t.lower() for t in report.unlisted_technologies)
    assert any("solidity" in t.lower() for t in report.unlisted_technologies)
    assert "REJECTED" in report.verdict_notes


def test_factual_guard_blocks_fabricated_employers():
    guard = FactualVerificationGuard()
    bad_proposal = """
    Hi, I am an ex-Netflix engineer who worked at Meta and led team at Apple.
    I have deep Java experience.
    """
    report = guard.verify_proposal(bad_proposal)
    assert report.is_valid is False
    assert len(report.unverified_claims) >= 1
    assert any("Fabricated employer" in c for c in report.unverified_claims)


def test_factual_guard_blocks_suspicious_metrics():
    guard = FactualVerificationGuard()
    bad_proposal = """
    I redesigned an architecture that boosted conversion by 350% and scaled to 5 million users in 2 weeks.
    I am available 24/7 with 100% guaranteed success.
    """
    report = guard.verify_proposal(bad_proposal)
    assert report.is_valid is False
    assert len(report.suspicious_metrics) >= 1
    assert any("Unverified percentage" in c or "Unverified user scale" in c for c in report.unverified_claims)


def test_factual_guard_approves_verified_proposal():
    guard = FactualVerificationGuard()
    authentic_proposal = """
    Hi,

    I reviewed your requirements for optimizing your Android application.
    Production stability on the Google Play Store requires clean memory management,
    modular React Native native bridges, and proper threading.

    Technical Plan:
    1. Perform memory leak diagnostic and frame rate profiling.
    2. Optimize background tasks and native Android components.
    3. Verify Google Play Store policy and release guidelines.

    Relevant Production Experience:
    - ClothMatics: Production e-commerce Android application live on Google Play Store (React Native + Android native).
    - Enterprise Financial Core: High-throughput transaction engine with Spring Boot and Java.

    I bring 10 years of hands-on software development experience across enterprise Java/Spring backends and React/Android apps.
    Happy to discuss next steps.

    Best regards,
    Chirag
    """
    report = guard.verify_proposal(authentic_proposal)
    assert report.is_valid is True
    assert len(report.unverified_claims) == 0
    assert len(report.unlisted_technologies) == 0
    assert "passed factual verification" in report.verdict_notes


# ---------------------------------------------------------
# Proposal Generation Agent Integration Tests
# ---------------------------------------------------------

@pytest.mark.asyncio
async def test_proposal_generation_agent_workflow(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_prop_test_1",
        source="remoteok",
        title="Senior Android & React Native Optimization",
        description="We need an expert to optimize performance of our production mobile app on Google Play.",
        url="https://remoteok.com/job/prop1",
        budget_min=1200.0,
        budget_max=1800.0,
        required_skills_json=json.dumps(["Android", "React Native"]),
        status="qualified",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    agent = ProposalGenerationAgent()
    proposal, report = await agent.generate_proposal(
        opportunity_id=opp.id,
        session=test_db_session,
        custom_strategy="live_app_case_study",
        custom_price=1500.0,
    )

    assert isinstance(proposal, ProposalModel)
    assert proposal.is_factually_verified is True
    assert report.is_valid is True
    assert "ClothMatics" in proposal.cover_letter
    assert "Google Play Store" in proposal.cover_letter
    assert "Chirag" in proposal.cover_letter

    # Verify Application record created in DB
    app_stmt = select(ApplicationModel).where(ApplicationModel.opportunity_id == opp.id)
    app_res = await test_db_session.execute(app_stmt)
    application = app_res.scalars().first()
    assert application is not None
    assert application.status == "pending_approval"
    assert application.proposed_price == 1500.0

    # Verify Audit log recorded
    audit_stmt = select(AuditLogModel).where(
        AuditLogModel.event_type == "proposal_generated",
        AuditLogModel.entity_id == proposal.id,
    )
    audit_res = await test_db_session.execute(audit_stmt)
    audit = audit_res.scalars().first()
    assert audit is not None


# ---------------------------------------------------------
# FastAPI Endpoints Tests
# ---------------------------------------------------------

@pytest.mark.asyncio
async def test_api_proposal_endpoints(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_api_prop_1",
        source="remoteok",
        title="Enterprise Java Backend Developer",
        description="Architect high throughput REST microservices with Spring Boot.",
        url="https://remoteok.com/job/api_prop",
        budget_max=2200.0,
        required_skills_json=json.dumps(["Java", "Spring Boot"]),
        status="qualified",
    )
    test_db_session.add(opp)
    await test_db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # POST generate proposal
        resp = await client.post(
            f"/api/opportunities/{opp.id}/propose",
            json={"strategy": "enterprise_architecture_first", "proposed_price": 2000.0},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "proposal_id" in data
        assert "cover_letter" in data
        assert data["is_factually_verified"] is True
        assert "Spring Boot" in data["cover_letter"]

        # POST verify proposal text directly
        verify_resp = await client.post(
            "/api/proposals/verify",
            json={"text": "I am a senior Java and React developer with 10 years experience."},
        )
        assert verify_resp.status_code == 200
        verify_data = verify_resp.json()
        assert verify_data["is_valid"] is True

        # POST verify proposal with unlisted tech
        verify_bad = await client.post(
            "/api/proposals/verify",
            json={"text": "I am a Rust blockchain smart contract expert."},
        )
        assert verify_bad.status_code == 200
        bad_data = verify_bad.json()
        assert bad_data["is_valid"] is False

        # GET applications list
        apps_resp = await client.get("/api/applications")
        assert apps_resp.status_code == 200
        apps_data = apps_resp.json()
        assert len(apps_data) >= 1
        found_app = next(a for a in apps_data if a["opportunity_id"] == opp.id)
        assert found_app["status"] == "pending_approval"
        assert found_app["latest_proposal"] is not None
        assert found_app["latest_proposal"]["is_factually_verified"] is True
