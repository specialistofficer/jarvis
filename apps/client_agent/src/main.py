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
