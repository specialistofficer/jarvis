"""
FastAPI application entry point for Personal AI Client Acquisition Agent.
"""
import json
from contextlib import asynccontextmanager
from typing import AsyncGenerator, List
from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.database import init_db, get_db_session
from src.profile.service import seed_profile_and_portfolio, get_owner_profile
from src.profile.owner_data import PORTFOLIO_ITEMS
from src.models.schemas import OwnerProfileSchema, PortfolioItemSchema
from src.audit.logger import fetch_audit_logs, record_audit_event
from src.ai.provider import get_ai_provider


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Initialize DB schema
    await init_db()
    # Seed owner profile and portfolio
    async for session in get_db_session():
        await seed_profile_and_portfolio(session)
        break
    yield


app = FastAPI(
    title="Jarvis - Personal AI Client Acquisition Agent",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health_check():
    provider = get_ai_provider()
    return {
        "ok": True,
        "service": "client-acquisition-agent",
        "environment": settings.ENVIRONMENT,
        "ai_provider": provider.name,
        "cost_policy": {
            "allow_paid_spend": settings.ALLOW_PAID_SPEND,
            "max_cost_inr": settings.MAX_COST_INR,
        },
    }


@app.get("/api/profile", response_model=OwnerProfileSchema)
async def read_profile(session: AsyncSession = Depends(get_db_session)):
    return await get_owner_profile(session)


@app.get("/api/portfolio", response_model=List[PortfolioItemSchema])
async def read_portfolio():
    return PORTFOLIO_ITEMS


@app.get("/api/audit-logs")
async def read_audit_logs(limit: int = 50, session: AsyncSession = Depends(get_db_session)):
    logs = await fetch_audit_logs(session, limit=limit)
    return [
        {
            "id": log.id,
            "event_type": log.event_type,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "details": log.details_json,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]


from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select
from src.agents.discovery import DiscoveryAgent, DiscoveryRunResult
from src.models.entities import OpportunityModel

discovery_agent = DiscoveryAgent()


class DiscoveryRunRequest(BaseModel):
    query: Optional[str] = None
    sources: Optional[List[str]] = None
    limit: int = 15


@app.post("/api/discovery/run", response_model=DiscoveryRunResult)
async def trigger_discovery(
    req: DiscoveryRunRequest = DiscoveryRunRequest(),
    session: AsyncSession = Depends(get_db_session),
):
    """Trigger an autonomous discovery cycle across configured sources."""
    return await discovery_agent.run_discovery(
        session=session,
        query=req.query,
        source_names=req.sources,
        per_source_limit=req.limit,
    )


@app.get("/api/opportunities")
async def list_opportunities(
    source: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    session: AsyncSession = Depends(get_db_session),
):
    """List discovered opportunities with optional filters."""
    stmt = select(OpportunityModel).order_by(OpportunityModel.created_at.desc()).limit(limit)
    if source:
        stmt = stmt.where(OpportunityModel.source == source)
    if status:
        stmt = stmt.where(OpportunityModel.status == status)

    result = await session.execute(stmt)
    opps = result.scalars().all()
    return [
        {
            "id": o.id,
            "fingerprint": o.fingerprint,
            "source": o.source,
            "external_id": o.external_id,
            "title": o.title,
            "description": o.description,
            "url": o.url,
            "client_name": o.client_name,
            "client_country": o.client_country,
            "budget_min": o.budget_min,
            "budget_max": o.budget_max,
            "currency": o.currency,
            "application_cost": o.application_cost,
            "status": o.status,
            "created_at": o.created_at.isoformat() if o.created_at else None,
        }
        for o in opps
    ]


from src.intelligence.agent import OpportunityIntelligenceAgent
from src.models.entities import OpportunityScoreModel
from src.models.schemas import OpportunityScoreResult

intelligence_agent = OpportunityIntelligenceAgent()


class BatchScoreRequest(BaseModel):
    limit: int = 25


@app.post("/api/opportunities/{opportunity_id}/score", response_model=OpportunityScoreResult)
async def score_opportunity_endpoint(
    opportunity_id: str,
    session: AsyncSession = Depends(get_db_session),
):
    """Trigger multi-factor scoring and economics evaluation for a specific opportunity."""
    stmt = select(OpportunityModel).where(OpportunityModel.id == opportunity_id).limit(1)
    res = await session.execute(stmt)
    opp = res.scalars().first()
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    return await intelligence_agent.evaluate_opportunity(opp, session=session)


@app.post("/api/opportunities/score-batch", response_model=List[OpportunityScoreResult])
async def score_pending_opportunities_endpoint(
    req: BatchScoreRequest = BatchScoreRequest(),
    session: AsyncSession = Depends(get_db_session),
):
    """Trigger scoring on pending unscored opportunities."""
    return await intelligence_agent.score_pending_opportunities(session=session, limit=req.limit)


@app.get("/api/opportunities/{opportunity_id}/score")
async def get_opportunity_score_endpoint(
    opportunity_id: str,
    session: AsyncSession = Depends(get_db_session),
):
    """Retrieve saved evaluation and multi-factor score for an opportunity."""
    stmt = (
        select(OpportunityScoreModel)
        .where(OpportunityScoreModel.opportunity_id == opportunity_id)
        .limit(1)
    )
    res = await session.execute(stmt)
    score = res.scalars().first()
    if not score:
        raise HTTPException(status_code=404, detail="Score not found for this opportunity")

    return {
        "id": score.id,
        "opportunity_id": score.opportunity_id,
        "fit_score": score.fit_score,
        "technical_match": score.technical_match,
        "portfolio_match": score.portfolio_match,
        "client_quality": score.client_quality,
        "value_score": score.value_score,
        "competition_score": score.competition_score,
        "risk_score": score.risk_score,
        "recommended_action": score.recommended_action,
        "reasoning": json.loads(score.reasoning_json),
        "recommended_portfolio_slugs": json.loads(score.recommended_portfolio_ids_json),
        "recommended_strategy": score.recommended_strategy,
        "created_at": score.created_at.isoformat() if score.created_at else None,
    }


@app.get("/api/sources")
async def list_sources():
    """List all registered sources with capability definitions."""
    return [adapter.capability.model_dump() for adapter in discovery_agent._adapters.values()]


from sqlalchemy.orm import selectinload
from src.proposals.agent import ProposalGenerationAgent
from src.proposals.validator import FactualVerificationGuard
from src.models.entities import ApplicationModel, ProposalModel
from src.models.schemas import FactualVerificationReport

proposal_agent = ProposalGenerationAgent()
factual_guard = FactualVerificationGuard()


class ProposalGenerateRequest(BaseModel):
    strategy: Optional[str] = None
    proposed_price: Optional[float] = None


class VerifyProposalRequest(BaseModel):
    text: str


@app.post("/api/opportunities/{opportunity_id}/propose")
async def generate_proposal_endpoint(
    opportunity_id: str,
    req: ProposalGenerateRequest = ProposalGenerateRequest(),
    session: AsyncSession = Depends(get_db_session),
):
    """Generate, factually verify, and record a customized proposal for an opportunity."""
    try:
        proposal, verification = await proposal_agent.generate_proposal(
            opportunity_id=opportunity_id,
            session=session,
            custom_strategy=req.strategy,
            custom_price=req.proposed_price,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return {
        "proposal_id": proposal.id,
        "application_id": proposal.application_id,
        "strategy": proposal.strategy,
        "cover_letter": proposal.cover_letter,
        "is_factually_verified": proposal.is_factually_verified,
        "verification_report": json.loads(proposal.verification_report_json),
        "created_at": proposal.created_at.isoformat() if proposal.created_at else None,
    }


@app.post("/api/proposals/verify", response_model=FactualVerificationReport)
async def verify_proposal_text_endpoint(req: VerifyProposalRequest):
    """Directly audit a proposal draft against the Zero Factual Invention policy."""
    return factual_guard.verify_proposal(req.text)


@app.get("/api/applications")
async def list_applications(
    status: Optional[str] = None,
    limit: int = 50,
    session: AsyncSession = Depends(get_db_session),
):
    """List applications along with their proposals and opportunity details."""
    stmt = (
        select(ApplicationModel)
        .options(
            selectinload(ApplicationModel.proposals),
            selectinload(ApplicationModel.opportunity),
        )
        .order_by(ApplicationModel.created_at.desc())
        .limit(limit)
    )
    if status:
        stmt = stmt.where(ApplicationModel.status == status)

    res = await session.execute(stmt)
    apps = res.scalars().all()

    results = []
    for a in apps:
        latest_proposal = a.proposals[-1] if a.proposals else None
        results.append({
            "id": a.id,
            "opportunity_id": a.opportunity_id,
            "opportunity_title": a.opportunity.title if a.opportunity else None,
            "opportunity_source": a.opportunity.source if a.opportunity else None,
            "status": a.status,
            "mode": a.mode,
            "proposed_price": a.proposed_price,
            "submission_url": a.submission_url,
            "latest_proposal": {
                "id": latest_proposal.id,
                "strategy": latest_proposal.strategy,
                "is_factually_verified": latest_proposal.is_factually_verified,
                "cover_letter": latest_proposal.cover_letter,
                "created_at": latest_proposal.created_at.isoformat() if latest_proposal.created_at else None,
            } if latest_proposal else None,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        })
    return results


from src.interfaces.telegram_bot import TelegramBotService

telegram_service = TelegramBotService()


@app.post("/api/notifications/telegram/alert/{opportunity_id}")
async def trigger_telegram_alert(
    opportunity_id: str,
    session: AsyncSession = Depends(get_db_session),
):
    """Send interactive Telegram notification for an opportunity."""
    opp_stmt = select(OpportunityModel).where(OpportunityModel.id == opportunity_id).limit(1)
    opp_res = await session.execute(opp_stmt)
    opp = opp_res.scalars().first()
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")

    score_stmt = select(OpportunityScoreModel).where(OpportunityScoreModel.opportunity_id == opportunity_id).limit(1)
    score_res = await session.execute(score_stmt)
    score = score_res.scalars().first()

    app_stmt = select(ApplicationModel).where(ApplicationModel.opportunity_id == opportunity_id).limit(1)
    app_res = await session.execute(app_stmt)
    application = app_res.scalars().first()

    res = await telegram_service.send_opportunity_alert(
        opp=opp,
        score=score,
        application=application,
    )
    return res


@app.post("/api/notifications/telegram/webhook")
async def telegram_webhook_endpoint(
    update: Dict[str, Any],
    session: AsyncSession = Depends(get_db_session),
):
    """Handle incoming Telegram webhook updates (callback queries, commands)."""
    return await telegram_service.process_update(update=update, session=session)


@app.post("/api/applications/{application_id}/approve")
async def approve_application_endpoint(
    application_id: str,
    session: AsyncSession = Depends(get_db_session),
):
    """Approve an application for submission."""
    app_stmt = select(ApplicationModel).where(ApplicationModel.id == application_id).limit(1)
    app_res = await session.execute(app_stmt)
    application = app_res.scalars().first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    application.status = "approved"
    await record_audit_event(
        session=session,
        event_type="proposal_approved",
        entity_type="application",
        entity_id=application.id,
        details={"approved_by": "founder_api"},
    )
    await session.commit()
    return {"ok": True, "application_id": application.id, "status": application.status}


@app.post("/api/applications/{application_id}/reject")
async def reject_application_endpoint(
    application_id: str,
    session: AsyncSession = Depends(get_db_session),
):
    """Reject an application."""
    app_stmt = select(ApplicationModel).where(ApplicationModel.id == application_id).limit(1)
    app_res = await session.execute(app_stmt)
    application = app_res.scalars().first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    application.status = "rejected"
    await record_audit_event(
        session=session,
        event_type="application_rejected",
        entity_type="application",
        entity_id=application.id,
        details={"rejected_by": "founder_api"},
    )
    await session.commit()
    return {"ok": True, "application_id": application.id, "status": application.status}


from src.execution.controller import ExecutionModeController
from src.execution.packager import ApplicationPackager
from src.models.schemas import SubmissionPackageSchema

execution_controller = ExecutionModeController()
application_packager = ApplicationPackager()


@app.post("/api/applications/{application_id}/submit")
async def submit_application_endpoint(
    application_id: str,
    session: AsyncSession = Depends(get_db_session),
):
    """Execute application submission or generate 1-click manual package."""
    try:
        return await execution_controller.execute_submission(application_id, session=session)
    except PermissionError as pe:
        raise HTTPException(status_code=403, detail=str(pe))
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@app.get("/api/applications/{application_id}/package", response_model=SubmissionPackageSchema)
async def get_application_package_endpoint(
    application_id: str,
    session: AsyncSession = Depends(get_db_session),
):
    """Retrieve 1-click submission package with verified proposal and portfolio links."""
    app_stmt = (
        select(ApplicationModel)
        .options(
            selectinload(ApplicationModel.opportunity),
            selectinload(ApplicationModel.proposals),
        )
        .where(ApplicationModel.id == application_id)
        .limit(1)
    )
    app_res = await session.execute(app_stmt)
    application = app_res.scalars().first()
    if not application:
        raise HTTPException(status_code=404, detail="Application not found")

    try:
        return application_packager.build_package(application)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


from src.responses.classifier import ResponseIntentClassifier
from src.responses.drafter import ContextualResponseDrafter
from src.models.schemas import MessageIntentResult, ResponseDraftResult
from src.models.entities import MessageModel

response_classifier = ResponseIntentClassifier()
response_drafter = ContextualResponseDrafter()


class ClassifyRequest(BaseModel):
    text: str


class DraftResponseRequest(BaseModel):
    application_id: str
    incoming_text: str


@app.post("/api/responses/classify", response_model=MessageIntentResult)
async def classify_message_endpoint(req: ClassifyRequest):
    """Classify incoming client message intent."""
    return response_classifier.classify(req.text)


@app.post("/api/responses/draft", response_model=ResponseDraftResult)
async def draft_response_endpoint(
    req: DraftResponseRequest,
    session: AsyncSession = Depends(get_db_session),
):
    """Generate and store contextual response draft for an application."""
    try:
        return await response_drafter.draft_response(
            application_id=req.application_id,
            incoming_text=req.incoming_text,
            session=session,
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))


@app.get("/api/applications/{application_id}/messages")
async def list_application_messages(
    application_id: str,
    session: AsyncSession = Depends(get_db_session),
):
    """List message history and response drafts for an application."""
    stmt = (
        select(MessageModel)
        .where(MessageModel.application_id == application_id)
        .order_by(MessageModel.created_at.asc())
    )
    res = await session.execute(stmt)
    msgs = res.scalars().all()
    return [
        {
            "id": m.id,
            "application_id": m.application_id,
            "sender": m.sender,
            "text": m.text,
            "intent": m.intent,
            "suggested_reply": m.suggested_reply,
            "status": m.status,
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in msgs
    ]





