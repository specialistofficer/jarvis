"""
Pytest configuration and test fixtures for Client Acquisition Agent.
"""
import os
import pytest
import pytest_asyncio
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession

# Force testing environment before importing settings
os.environ["ENVIRONMENT"] = "testing"
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///./test_agent.db"

from src.database import Base, init_db, async_session_factory, engine
from src.profile.service import seed_profile_and_portfolio
from src.main import app


@pytest_asyncio.fixture(autouse=True, scope="function")
async def setup_test_database():
    """Ensure clean database schema and seeded data exist before each test."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with async_session_factory() as session:
        await seed_profile_and_portfolio(session)


@pytest_asyncio.fixture(scope="function")
async def test_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provides an active database session for test functions."""
    async with async_session_factory() as session:
        yield session
