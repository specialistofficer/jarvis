"""
Tests for FastAPI HTTP endpoints.
"""
import pytest
from httpx import AsyncClient, ASGITransport
from src.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        assert data["service"] == "client-acquisition-agent"
        assert "cost_policy" in data
        assert data["cost_policy"]["allow_paid_spend"] is False


@pytest.mark.asyncio
async def test_portfolio_endpoint():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/portfolio")
        assert response.status_code == 200
        items = response.json()
        assert len(items) >= 4
        names = [item["name"] for item in items]
        assert any("ClothMatics" in n for n in names)
        assert any("Banking" in n or "Financial" in n for n in names)
