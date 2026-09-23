"""
Tests for Response Monitoring and Communication Drafter.
Verifies intent classification across all 7 categories and contextual reply generation.
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from httpx import AsyncClient, ASGITransport

from src.responses.classifier import ResponseIntentClassifier
from src.responses.drafter import ContextualResponseDrafter
from src.models.entities import OpportunityModel, ApplicationModel, ProposalModel, MessageModel, AuditLogModel
from src.models.schemas import MessageIntentResult, ResponseDraftResult
from src.main import app


# ---------------------------------------------------------
# Intent Classifier Unit Tests
# ---------------------------------------------------------

def test_intent_classifier_all_categories():
    classifier = ResponseIntentClassifier()

    # 1. INTERVIEW
    res_interview = classifier.classify("Can we schedule a call tomorrow afternoon on Google Meet?")
    assert res_interview.intent == "INTERVIEW"
    assert res_interview.confidence >= 0.85

    # 2. QUESTION
    res_question = classifier.classify("Do you have experience with Oracle SQL schema design and Spring Boot?")
    assert res_question.intent == "QUESTION"

    # 3. NEGOTIATION
    res_negotiation = classifier.classify("The rate is too high, can you do this for $1,200 instead?")
    assert res_negotiation.intent == "NEGOTIATION"

    # 4. REJECTION
    res_rejection = classifier.classify("Thank you for your time, but we decided to go with another candidate.")
    assert res_rejection.intent == "REJECTION"

    # 5. SPAM
    res_spam = classifier.classify("Earn $500 per day clicking links. Join our telegram group now!")
    assert res_spam.intent == "SPAM"

    # 6. INTERESTED
    res_interested = classifier.classify("We liked your proposal and want to work together. When can you start?")
    assert res_interested.intent == "INTERESTED"

    # 7. UNCLEAR
    res_unclear = classifier.classify("ok thanks")
    assert res_unclear.intent == "UNCLEAR"


# ---------------------------------------------------------
# Contextual Response Drafter Tests
# ---------------------------------------------------------

@pytest.mark.asyncio
async def test_contextual_drafter_interview_and_persistence(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_resp_1",
        source="remoteok",
        title="Senior Spring Boot & React Architect",
        description="Senior enterprise dev",
        url="https://remoteok.com/job/resp1",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_record = ApplicationModel(
        opportunity_id=opp.id,
        status="submitted",
        proposed_price=2500.0,
    )
    test_db_session.add(app_record)
    await test_db_session.commit()

    drafter = ContextualResponseDrafter()
    client_msg = "Your profile looks great. Can we jump on a call this Thursday to discuss?"

    result = await drafter.draft_response(
        application_id=app_record.id,
        incoming_text=client_msg,
        session=test_db_session,
    )

    assert isinstance(result, ResponseDraftResult)
    assert result.intent == "INTERVIEW"
    assert "IST" in result.suggested_reply
    assert "India" in result.suggested_reply
    assert result.recommended_action == "REVIEW_AND_SCHEDULE_CALL"

    # Verify MessageModel in database
    msg_stmt = select(MessageModel).where(MessageModel.application_id == app_record.id)
    msg_res = await test_db_session.execute(msg_stmt)
    saved_msg = msg_res.scalars().first()
    assert saved_msg is not None
    assert saved_msg.intent == "INTERVIEW"
    assert saved_msg.text == client_msg

    # Verify Audit log
    audit_stmt = select(AuditLogModel).where(
        AuditLogModel.event_type == "client_response_processed",
        AuditLogModel.entity_id == app_record.id,
    )
    audit_res = await test_db_session.execute(audit_stmt)
    assert audit_res.scalars().first() is not None


@pytest.mark.asyncio
async def test_contextual_drafter_negotiation(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_resp_neg",
        source="upwork",
        title="Mobile App Optimization",
        description="Android optimization",
        url="https://upwork.com/job/resp_neg",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_record = ApplicationModel(
        opportunity_id=opp.id,
        status="submitted",
        proposed_price=1800.0,
    )
    test_db_session.add(app_record)
    await test_db_session.commit()

    drafter = ContextualResponseDrafter()
    neg_msg = "Can you lower your price? We only have a budget of $1,400."

    result = await drafter.draft_response(
        application_id=app_record.id,
        incoming_text=neg_msg,
        session=test_db_session,
    )

    assert result.intent == "NEGOTIATION"
    assert "milestones" in result.suggested_reply.lower()
    assert result.recommended_action == "NEGOTIATE_MILESTONES"


# ---------------------------------------------------------
# FastAPI Endpoints Tests
# ---------------------------------------------------------

@pytest.mark.asyncio
async def test_api_response_endpoints(test_db_session: AsyncSession):
    opp = OpportunityModel(
        fingerprint="fp_api_resp_1",
        source="remoteok",
        title="Java Microservices Developer",
        description="Java dev",
        url="https://remoteok.com/job/api_resp",
    )
    test_db_session.add(opp)
    await test_db_session.flush()

    app_record = ApplicationModel(
        opportunity_id=opp.id,
        status="submitted",
        proposed_price=2000.0,
    )
    test_db_session.add(app_record)
    await test_db_session.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # POST classify
        classify_resp = await client.post(
            "/api/responses/classify",
            json={"text": "When are you available for a quick zoom interview?"},
        )
        assert classify_resp.status_code == 200
        cls_data = classify_resp.json()
        assert cls_data["intent"] == "INTERVIEW"

        # POST draft response
        draft_resp = await client.post(
            "/api/responses/draft",
            json={
                "application_id": app_record.id,
                "incoming_text": "Do you have production experience with Java and Spring?",
            },
        )
        assert draft_resp.status_code == 200
        draft_data = draft_resp.json()
        assert draft_data["intent"] == "QUESTION"
        assert "10 years" in draft_data["suggested_reply"]

        # GET messages
        msgs_resp = await client.get(f"/api/applications/{app_record.id}/messages")
        assert msgs_resp.status_code == 200
        msgs_data = msgs_resp.json()
        assert len(msgs_data) == 1
        assert msgs_data[0]["intent"] == "QUESTION"
