"""
Tests for Database schema, persistence, and audit logging.
"""
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.entities import OwnerProfileModel, PortfolioItemModel, OpportunityModel
from src.audit.logger import record_audit_event, fetch_audit_logs


@pytest.mark.asyncio
async def test_database_seeding(test_db_session: AsyncSession):
    # Verify profile was seeded
    result = await test_db_session.execute(select(OwnerProfileModel))
    profile = result.scalars().first()
    assert profile is not None
    assert profile.name == "Chirag"

    # Verify portfolio items were seeded
    port_res = await test_db_session.execute(select(PortfolioItemModel))
    items = list(port_res.scalars().all())
    assert len(items) >= 4
    slugs = [item.slug for item in items]
    assert "clothmatics-ai" in slugs
    assert "enterprise-financial-core" in slugs
    assert "jarvis-growth-engine" in slugs


@pytest.mark.asyncio
async def test_audit_event_recording(test_db_session: AsyncSession):
    entry = await record_audit_event(
        session=test_db_session,
        event_type="opportunity_scored",
        entity_type="opportunity",
        entity_id="test-opp-123",
        details={"score": 92.5, "action": "APPLY", "reason": "High technical alignment"},
    )
    assert entry.id is not None
    assert entry.event_type == "opportunity_scored"

    logs = await fetch_audit_logs(test_db_session, entity_type="opportunity")
    assert len(logs) >= 1
    assert logs[0].entity_id == "test-opp-123"
