"""
FastAPI application entry point for Personal AI Client Acquisition Agent.
"""
from contextlib import asynccontextmanager
from typing import AsyncGenerator, List
from fastapi import FastAPI, Depends
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


@app.get("/api/sources")
async def list_sources():
    """List all registered sources with capability definitions."""
    return [adapter.capability.model_dump() for adapter in discovery_agent._adapters.values()]

