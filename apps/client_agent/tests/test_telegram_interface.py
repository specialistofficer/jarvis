"""
Tests for Telegram Notification and Interactive Control Interface.
Verifies interactive buttons ([APPLY], [SKIP], [VIEW PROPOSAL]),
strict approval workflows, and zero live external network calls.
"""
import pytest
import json
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from httpx import AsyncClient, ASGITransport

from src.interfaces.telegram_bot import TelegramBotService
from src.models.entities import OpportunityModel, OpportunityScoreModel, ApplicationModel, ProposalModel, AuditLogModel
from src.main import app, telegram_service


# ---------------------------------------------------------
# Telegram Bot Service Unit Tests
# ---------------------------------------------------------

def test_telegram_alert_formatting():
    bot = TelegramBotService()
    opp = OpportunityModel(
        fingerprint="fp_tg_1",
        source="remoteok",
        title="Full-Stack React & Spring Boot Developer <Urgent>",
        description="Senior engineer needed for microservices.",
        url="https://remoteok.com/job/tg1",
        client_name="Acme Inc",
        client_country="United States",
        client_rating=4.9,
        client_spend=12000.0,
        budget_min=2000.0,
        budget_max=3000.0,
        currency="USD",
        application_cost=0.0,
    )
    score = OpportunityScoreModel(
        fit_score=85.0,
        technical_match=90.0,
        portfolio_match=80.0,
        client_quality=85.0,
        value_score=85.0,
        competition_score=70.0,
        risk_score=0.0,
        recommended_action="APPLY",
        recommended_strategy="enterprise_architecture_first",
    )
    app_record = ApplicationModel(
        id="app_test_123",
        opportunity_id=opp.id,
        status="pending_approval",
    )

    text, markup = bot.format_opportunity_alert(opp, score=score, application=app_record)

    # HTML safety check
    assert "&lt;Urgent&gt;" in text
    assert "<Urgent>" not in text
    assert "85.0%" in text
    assert "APPLY" in text
    assert "Acme Inc" in text

    # Verify buttons
    keyboard = markup["inline_keyboard"]
    assert len(keyboard) == 2
    row1 = keyboard[0]
    row2 = keyboard[1]
    assert any(b.get("callback_data") == "apply:app_test_123" for b in row1)
    assert any(b.get("callback_data") == "view_prop:app_test_123" for b in row1)
    assert any(b.get("url") == opp.url for b in row2)
    assert any(b.get("callback_data") == "skip:app_test_123" for b in row2)


@pytest.mark.asyncio
async def test_telegram_send_mock_in_test_env():
    bot = TelegramBotService()
    res = await bot.send_message("Test message")
    assert res["ok"] is True
    assert len(bot.sent_messages) == 1
    assert bot.sent_messages[0]["text"] == "Test message"


@pytest.mark.asyncio
async def test_telegram_callback_apply(test_db_session: AsyncSession):
    bot = TelegramBotService()

    # Seed opportunity and application
    opp = OpportunityModel(
        fingerprint="fp_tg_apply_1",
        source="remoteok",
        title="Java & React Lead",
        description="Lead developer",
        url="https://remoteok.com/job/apply1",
        status="qualified",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_record = ApplicationModel(
        opportunity_id=opp.id,
        status="pending_approval",
        submission_url=opp.url,
    )
    test_db_session.add(app_record)
    await test_db_session.commit()

    callback_payload = {
        "id": "query_123",
        "data": f"apply:{app_record.id}",
        "message": {
            "message_id": 42,
            "text": "Opportunity details...",
            "chat": {"id": 123456},
        },
    }

    res = await bot.handle_callback_query(callback_payload, session=test_db_session)
    assert res["ok"] is True
    assert res["action"] == "applied"

    # Verify database state
    app_stmt = select(ApplicationModel).where(ApplicationModel.id == app_record.id)
    app_res = await test_db_session.execute(app_stmt)
    updated = app_res.scalars().first()
    assert updated.status == "approved"

    # Verify audit log
    audit_stmt = select(AuditLogModel).where(
        AuditLogModel.event_type == "proposal_approved",
        AuditLogModel.entity_id == app_record.id,
    )
    audit_res = await test_db_session.execute(audit_stmt)
    assert audit_res.scalars().first() is not None


@pytest.mark.asyncio
async def test_telegram_callback_skip(test_db_session: AsyncSession):
    bot = TelegramBotService()

    opp = OpportunityModel(
        fingerprint="fp_tg_skip_1",
        source="remoteok",
        title="Unwanted Job",
        description="Not a fit",
        url="https://remoteok.com/job/skip1",
        status="discovered",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_record = ApplicationModel(
        opportunity_id=opp.id,
        status="pending_approval",
    )
    test_db_session.add(app_record)
    await test_db_session.commit()

    callback_payload = {
        "id": "query_skip_1",
        "data": f"skip:{app_record.id}",
        "message": {
            "message_id": 43,
            "text": "Opportunity details...",
            "chat": {"id": 123456},
        },
    }

    res = await bot.handle_callback_query(callback_payload, session=test_db_session)
    assert res["ok"] is True
    assert res["action"] == "skipped"

    # Verify status changed to rejected
    app_stmt = select(ApplicationModel).where(ApplicationModel.id == app_record.id)
    app_res = await test_db_session.execute(app_stmt)
    updated = app_res.scalars().first()
    assert updated.status == "rejected"


@pytest.mark.asyncio
async def test_telegram_callback_view_proposal(test_db_session: AsyncSession):
    bot = TelegramBotService()

    opp = OpportunityModel(
        fingerprint="fp_tg_view_1",
        source="remoteok",
        title="Full Stack Java & React",
        description="Senior dev",
        url="https://remoteok.com/job/view1",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_record = ApplicationModel(
        opportunity_id=opp.id,
        status="pending_approval",
    )
    test_db_session.add(app_record)
    await test_db_session.flush()

    proposal = ProposalModel(
        application_id=app_record.id,
        version=1,
        cover_letter="Dear client, I am Chirag with 10 years experience in Java & React.",
        strategy="solution_first",
        is_factually_verified=True,
    )
    test_db_session.add(proposal)
    await test_db_session.commit()

    callback_payload = {
        "id": "query_view_1",
        "data": f"view_prop:{app_record.id}",
        "message": {"chat": {"id": 123456}},
    }

    res = await bot.handle_callback_query(callback_payload, session=test_db_session)
    assert res["ok"] is True
    assert res["action"] == "viewed_proposal"
    assert len(bot.sent_messages) == 1
    assert "Dear client" in bot.sent_messages[0]["text"]


@pytest.mark.asyncio
async def test_telegram_commands(test_db_session: AsyncSession):
    bot = TelegramBotService()

    help_res = await bot.handle_command("/help", "12345", session=test_db_session)
    assert help_res["ok"] is True
    assert "Jarvis Client Acquisition Agent" in bot.sent_messages[-1]["text"]

    status_res = await bot.handle_command("/status", "12345", session=test_db_session)
    assert status_res["ok"] is True
    assert "Client Acquisition System Status" in bot.sent_messages[-1]["text"]


# ---------------------------------------------------------
# FastAPI Endpoints Tests
# ---------------------------------------------------------

@pytest.mark.asyncio
async def test_api_telegram_alert_endpoint(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_api_tg_1",
        source="remoteok",
        title="Full Stack Engineer",
        description="Java React",
        url="https://remoteok.com/job/tg_api_1",
    )
    test_db_session.add(opp)
    await test_db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        resp = await client.post(f"/api/notifications/telegram/alert/{opp.id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True


@pytest.mark.asyncio
async def test_api_application_approve_and_reject_endpoints(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_api_app_1",
        source="remoteok",
        title="Senior Developer",
        description="Senior dev",
        url="https://remoteok.com/job/app_api_1",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    application = ApplicationModel(
        opportunity_id=opp.id,
        status="pending_approval",
    )
    test_db_session.add(application)
    await test_db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # Approve
        approve_resp = await client.post(f"/api/applications/{application.id}/approve")
        assert approve_resp.status_code == 200
        assert approve_resp.json()["status"] == "approved"

        # Reject
        reject_resp = await client.post(f"/api/applications/{application.id}/reject")
        assert reject_resp.status_code == 200
        assert reject_resp.json()["status"] == "rejected"
