"""
Tests for Owner Profile and Portfolio Knowledge Base.
"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from src.profile.owner_data import OWNER_PROFILE, PORTFOLIO_ITEMS, VERIFIED_SKILLS
from src.profile.service import (
    get_owner_profile,
    match_portfolio_items,
    is_skill_verified,
)


@pytest.mark.asyncio
async def test_owner_profile_attributes(test_db_session: AsyncSession):
    profile = await get_owner_profile(test_db_session)
    assert profile.name == "Chirag"
    assert profile.years_of_experience == 10
    assert "Java" in profile.skills
    assert "Spring Boot" in profile.skills
    assert "React" in profile.skills
    assert "React Native" in profile.skills
    assert "Android" in profile.skills
    assert "Oracle" in profile.skills


def test_verified_skills_lookup():
    assert is_skill_verified("Java") is True
    assert is_skill_verified("spring boot") is True
    assert is_skill_verified("react native") is True
    assert is_skill_verified("Android") is True
    assert is_skill_verified("Oracle SQL") is True

    # Unknown or fabricated skills must return False
    assert is_skill_verified("Solidity Web3 Smart Contract") is False
    assert is_skill_verified("Haskell Monad Compiler") is False
    assert is_skill_verified("Cobol Mainframe Legacy") is False


def test_portfolio_matching_android():
    # An opportunity requesting Android development should pick ClothMatics
    matches = match_portfolio_items(required_skills=["Android", "React Native"], max_items=2)
    assert len(matches) > 0
    assert matches[0].slug == "clothmatics-ai"
    assert "Google Play" in matches[0].description or any("Google Play" in f for f in matches[0].features)


def test_portfolio_matching_java_enterprise():
    # An opportunity requesting Java, Spring, Oracle should pick Enterprise Financial Core
    matches = match_portfolio_items(required_skills=["Java", "Spring Boot", "Oracle"], max_items=2)
    assert len(matches) > 0
    assert matches[0].slug == "enterprise-financial-core"
    assert "financial" in matches[0].name.lower() or "financial" in matches[0].industry.lower()


def test_portfolio_matching_ai_automation():
    # An opportunity requesting AI integration and scraping should pick Jarvis
    matches = match_portfolio_items(required_skills=["AI Integration", "Python", "FastAPI"], max_items=2)
    assert len(matches) > 0
    slugs = [m.slug for m in matches]
    assert "jarvis-growth-engine" in slugs or "clothmatics-ai" in slugs
