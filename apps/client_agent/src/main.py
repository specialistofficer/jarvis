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
from src.audit.logger import fetch_audit_logs
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


