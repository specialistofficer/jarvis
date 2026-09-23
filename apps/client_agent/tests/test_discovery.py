"""
Unit and integration tests for Multi-Source Discovery Engine.
"""
import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from httpx import AsyncClient, ASGITransport

from src.models.entities import OpportunityModel
from src.models.schemas import OpportunityCreateSchema, SourceCapabilitySchema
from src.sources.base import BaseSourceAdapter
from src.sources.fingerprint import (
    generate_opportunity_fingerprint,
    generate_from_opportunity,
    is_opportunity_stale,
    normalize_string,
)
from src.agents.discovery import DiscoveryAgent
from src.main import app


class MockSourceAdapter(BaseSourceAdapter):
    """Mock adapter for testing discovery orchestration."""

    def __init__(self, name: str = "mock_source", items: list = None):
        cap = SourceCapabilitySchema(
            source=name,
            category="marketplace",
            search_supported=True,
            read_supported=True,
            application_supported=False,
            requires_human_approval=True,
            application_cost=0.0,
        )
        super().__init__(cap)
        self._items = items or []

    async def fetch_opportunities(self, query=None, limit=20):
        return self._items[:limit]


def test_fingerprint_determinism():
    fp1 = generate_opportunity_fingerprint(
        source="upwork",
        title="Senior React & Spring Boot Developer",
        external_id="job_123",
    )
    fp2 = generate_opportunity_fingerprint(
        source="upwork",
        title="Senior React & Spring Boot Developer",
        external_id="job_123",
    )
    fp3 = generate_opportunity_fingerprint(
        source="upwork",
        title="Different Title",
        external_id="job_123",
    )
    assert fp1 == fp2
    assert fp1 == fp3  # Both anchored by external_id "job_123"

    # When no external_id, title and client anchor identity
    fp4 = generate_opportunity_fingerprint(
        source="remoteok",
        title="React / AI Developer!!",
        client_name="Acme Corp",
        budget_max=500.0,
    )
    fp5 = generate_opportunity_fingerprint(
        source="remoteok",
        title="  react   ai developer  ",
        client_name="acme corp",
        budget_max=500.0,
    )
    assert fp4 == fp5  # Normalization produces identical fingerprint


def test_stale_opportunity_detection():
    now = datetime.now(timezone.utc)
    fresh_date = now - timedelta(days=2)
    old_date = now - timedelta(days=20)

    assert is_opportunity_stale(fresh_date, max_age_days=14) is False
    assert is_opportunity_stale(old_date, max_age_days=14) is True


@pytest.mark.asyncio
async def test_discovery_agent_deduplication(test_db_session: AsyncSession):
    mock_items = [
        OpportunityCreateSchema(
            source="mock_test",
            external_id="ext_1",
            title="Full-Stack Java & React Engineer",
            description="Need an expert to build REST APIs and React dashboard",
            url="https://example.com/job/1",
            client_name="Client Alpha",
            budget_max=1200.0,
        ),
        OpportunityCreateSchema(
            source="mock_test",
            external_id="ext_2",
            title="Android App Optimization",
            description="Need Android expert to optimize Play Store app",
            url="https://example.com/job/2",
            client_name="Client Beta",
            budget_max=800.0,
        ),
    ]

    adapter = MockSourceAdapter(name="mock_test", items=mock_items)
    agent = DiscoveryAgent(adapters=[adapter])

    # First run: both should be inserted
    result1 = await agent.run_discovery(test_db_session)
    assert result1.inserted == 2
    assert result1.duplicates == 0

    # Verify DB rows
    db_res = await test_db_session.execute(select(OpportunityModel).where(OpportunityModel.source == "mock_test"))
    records = db_res.scalars().all()
    assert len(records) == 2

    # Second run: identical items must be recognized as duplicates and NOT re-inserted
    result2 = await agent.run_discovery(test_db_session)
    assert result2.inserted == 0
    assert result2.duplicates == 2

    # Verify DB count is still 2
    db_res2 = await test_db_session.execute(select(OpportunityModel).where(OpportunityModel.source == "mock_test"))
    records2 = db_res2.scalars().all()
    assert len(records2) == 2


@pytest.mark.asyncio
async def test_sources_api_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/sources")
        assert response.status_code == 200
        sources = response.json()
        assert len(sources) >= 4
        source_names = [s["source"] for s in sources]
        assert "remoteok" in source_names
        assert "hackernews" in source_names
        assert "upwork" in source_names
        assert "reddit_forhire" in source_names
        # Check capability matrix compliance
        for s in sources:
            assert s["requires_human_approval"] is True


@pytest.mark.asyncio
async def test_opportunities_api_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/opportunities")
        assert response.status_code == 200
        assert isinstance(response.json(), list)
