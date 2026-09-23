"""
Tests for Application Execution and Mode Control.
Verifies the 3 execution modes (MANUAL, APPROVAL_REQUIRED, AUTO),
human-in-the-loop safeguards, and 1-click submission packaging.
"""
import pytest
import json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from httpx import AsyncClient, ASGITransport

from src.execution.controller import ExecutionModeController
from src.execution.packager import ApplicationPackager
from src.models.entities import OpportunityModel, ApplicationModel, ProposalModel, AuditLogModel
from src.models.schemas import SourceCapabilitySchema, SubmissionPackageSchema
from src.main import app


# ---------------------------------------------------------
# Execution Mode Controller Unit Tests
# ---------------------------------------------------------

def test_mode_resolution_downgrades_auto_by_default():
    controller = ExecutionModeController()

    # AUTO is disabled by default in settings
    cap = SourceCapabilitySchema(
        source="upwork",
        category="marketplace",
        application_supported=True,
        requires_human_approval=True,
    )
    mode = controller.resolve_effective_mode("AUTO", source_capability=cap)
    assert mode == "APPROVAL_REQUIRED"

    # Restricted source without API or browser automation
    restricted_cap = SourceCapabilitySchema(
        source="reddit",
        category="community",
        application_supported=False,
        browser_automation_allowed=False,
        api_available=False,
        requires_human_approval=True,
    )
    mode_reddit = controller.resolve_effective_mode("APPROVAL_REQUIRED", source_capability=restricted_cap)
    assert mode_reddit == "MANUAL"


@pytest.mark.asyncio
async def test_submission_blocked_without_founder_approval(test_db_session: AsyncSession):
    controller = ExecutionModeController()

    opp = OpportunityModel(
        fingerprint="fp_exec_1",
        source="upwork",
        title="Enterprise Java Architect",
        description="Spring Boot and Oracle",
        url="https://upwork.com/job/exec1",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_record = ApplicationModel(
        opportunity_id=opp.id,
        status="pending_approval",
        mode="APPROVAL_REQUIRED",
    )
    test_db_session.add(app_record)
    await test_db_session.flush()

    prop = ProposalModel(
        application_id=app_record.id,
        cover_letter="Problem-first solution using Spring Boot.",
        is_factually_verified=True,
    )
    test_db_session.add(prop)
    await test_db_session.commit()

    # Submission should be blocked because status is pending_approval
    with pytest.raises(PermissionError) as exc_info:
        await controller.execute_submission(app_record.id, session=test_db_session)
    assert "Founder must approve" in str(exc_info.value)


@pytest.mark.asyncio
async def test_submission_blocked_if_proposal_unverified(test_db_session: AsyncSession):
    controller = ExecutionModeController()

    opp = OpportunityModel(
        fingerprint="fp_exec_unverified",
        source="upwork",
        title="Unverified Developer Task",
        description="Task",
        url="https://upwork.com/job/unverified",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_record = ApplicationModel(
        opportunity_id=opp.id,
        status="approved",
        mode="APPROVAL_REQUIRED",
    )
    test_db_session.add(app_record)
    await test_db_session.flush()

    # Proposal with is_factually_verified = False
    prop = ProposalModel(
        application_id=app_record.id,
        cover_letter="Invented claims.",
        is_factually_verified=False,
    )
    test_db_session.add(prop)
    await test_db_session.commit()

    with pytest.raises(ValueError) as exc_info:
        await controller.execute_submission(app_record.id, session=test_db_session)
    assert "failed factual verification" in str(exc_info.value)


@pytest.mark.asyncio
async def test_submission_succeeds_when_approved(test_db_session: AsyncSession):
    controller = ExecutionModeController()

    opp = OpportunityModel(
        fingerprint="fp_exec_success",
        source="upwork",
        title="React & Spring Boot Full Stack",
        description="Senior full stack engineer",
        url="https://upwork.com/job/success",
        budget_max=2500.0,
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_record = ApplicationModel(
        opportunity_id=opp.id,
        status="approved",
        mode="APPROVAL_REQUIRED",
        proposed_price=2200.0,
    )
    test_db_session.add(app_record)
    await test_db_session.flush()

    prop = ProposalModel(
        application_id=app_record.id,
        cover_letter="Verified cover letter citing 10-year Java experience.",
        portfolio_item_ids_json=json.dumps(["enterprise-financial-core"]),
        is_factually_verified=True,
    )
    test_db_session.add(prop)
    await test_db_session.commit()

    result = await controller.execute_submission(app_record.id, session=test_db_session)
    assert result["ok"] is True
    assert result["status"] == "submitted"
    assert "package" in result
    assert result["package"]["proposed_price"] == 2200.0

    # Verify audit event
    audit_stmt = select(AuditLogModel).where(
        AuditLogModel.event_type == "application_submitted",
        AuditLogModel.entity_id == app_record.id,
    )
    audit_res = await test_db_session.execute(audit_stmt)
    assert audit_res.scalars().first() is not None


# ---------------------------------------------------------
# Application Packager Tests
# ---------------------------------------------------------

def test_application_packager_generates_upwork_package():
    packager = ApplicationPackager()

    opp = OpportunityModel(
        id="opp_1",
        fingerprint="fp_pack_1",
        source="upwork",
        title="Android Google Play Optimization",
        description="Fix app performance",
        url="https://upwork.com/job/pack1",
        currency="USD",
    )
    app_record = ApplicationModel(
        id="app_pack_1",
        opportunity_id=opp.id,
        status="approved",
        mode="MANUAL",
        proposed_price=1500.0,
        submission_url=opp.url,
        opportunity=opp,
    )
    prop = ProposalModel(
        application_id=app_record.id,
        cover_letter="Cover letter citing ClothMatics.",
        strategy="live_app_case_study",
        portfolio_item_ids_json=json.dumps(["clothmatics-ai"]),
        is_factually_verified=True,
    )
    app_record.proposals = [prop]

    package = packager.build_package(app_record, proposal=prop, opportunity=opp)
    assert isinstance(package, SubmissionPackageSchema)
    assert package.submission_url == opp.url
    assert package.proposed_price == 1500.0
    assert "Upwork" in package.instructions
    assert len(package.portfolio_links) == 1
    assert "ClothMatics" in package.portfolio_links[0]["name"]
    assert "play.google.com" in package.portfolio_links[0]["url"]


# ---------------------------------------------------------
# FastAPI Endpoints Tests
# ---------------------------------------------------------

@pytest.mark.asyncio
async def test_api_submit_and_package_endpoints(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_api_exec_1",
        source="remoteok",
        title="Java REST API Engineer",
        description="REST backend",
        url="https://remoteok.com/job/api_exec",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_record = ApplicationModel(
        opportunity_id=opp.id,
        status="pending_approval",
        mode="APPROVAL_REQUIRED",
        proposed_price=1800.0,
    )
    test_db_session.add(app_record)
    await test_db_session.flush()

    prop = ProposalModel(
        application_id=app_record.id,
        cover_letter="Verified Spring Boot solution.",
        is_factually_verified=True,
    )
    test_db_session.add(prop)
    await test_db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # GET package
        pkg_resp = await client.get(f"/api/applications/{app_record.id}/package")
        assert pkg_resp.status_code == 200
        pkg_data = pkg_resp.json()
        assert pkg_data["application_id"] == app_record.id
        assert pkg_data["proposed_price"] == 1800.0
        assert "Spring Boot" in pkg_data["cover_letter"]

        # POST submit while pending -> 403 Forbidden
        submit_fail = await client.post(f"/api/applications/{app_record.id}/submit")
        assert submit_fail.status_code == 403

        # POST approve
        approve_resp = await client.post(f"/api/applications/{app_record.id}/approve")
        assert approve_resp.status_code == 200
        assert approve_resp.json()["status"] == "approved"

        # POST submit after approval -> 200 OK
        submit_ok = await client.post(f"/api/applications/{app_record.id}/submit")
        assert submit_ok.status_code == 200
        submit_data = submit_ok.json()
        assert submit_data["status"] == "submitted"
        assert submit_data["ok"] is True
