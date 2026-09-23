"""
Profile and Portfolio Knowledge Base Service.
Provides retrieval, seeding, and intelligent portfolio matching for opportunities.
"""
import json
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.entities import OwnerProfileModel, PortfolioItemModel
from src.models.schemas import OwnerProfileSchema, PortfolioItemSchema
from src.profile.owner_data import OWNER_PROFILE, PORTFOLIO_ITEMS, VERIFIED_SKILLS


async def seed_profile_and_portfolio(session: AsyncSession) -> None:
    """Seed the database with verified owner profile and portfolio items if not present."""
    # Check if profile exists
    result = await session.execute(select(OwnerProfileModel).limit(1))
    profile = result.scalars().first()
    if not profile:
        profile = OwnerProfileModel(
            name=OWNER_PROFILE.name,
            title=OWNER_PROFILE.title,
            years_of_experience=OWNER_PROFILE.years_of_experience,
            bio=OWNER_PROFILE.bio,
            skills_json=json.dumps(OWNER_PROFILE.skills),
            domains_json=json.dumps(OWNER_PROFILE.domains),
        )
        session.add(profile)

    # Seed portfolio items
    for item in PORTFOLIO_ITEMS:
        item_res = await session.execute(select(PortfolioItemModel).where(PortfolioItemModel.slug == item.slug))
        existing = item_res.scalars().first()
        if not existing:
            new_item = PortfolioItemModel(
                name=item.name,
                slug=item.slug,
                type=item.type,
                url=item.url,
                play_store_url=item.play_store_url,
                github_url=item.github_url,
                technologies_json=json.dumps(item.technologies),
                features_json=json.dumps(item.features),
                industry=item.industry,
                problem_solved=item.problem_solved,
                evidence_json=json.dumps(item.evidence),
                description=item.description,
            )
            session.add(new_item)

    await session.commit()


async def get_owner_profile(session: AsyncSession) -> OwnerProfileSchema:
    """Retrieve verified owner profile from DB, falling back to static verified data."""
    result = await session.execute(select(OwnerProfileModel).limit(1))
    row = result.scalars().first()
    if row:
        return OwnerProfileSchema(
            name=row.name,
            title=row.title,
            years_of_experience=row.years_of_experience,
            bio=row.bio,
            skills=json.loads(row.skills_json),
            domains=json.loads(row.domains_json),
        )
    return OWNER_PROFILE


def match_portfolio_items(
    required_skills: List[str],
    project_type: Optional[str] = None,
    max_items: int = 2,
) -> List[PortfolioItemSchema]:
    """
    Select the most factually relevant portfolio items based on tech stack and domain overlap.
    Never returns irrelevant items just to inflate proposals.
    """
    scored_items = []
    normalized_skills = [s.lower().strip() for s in required_skills]

    for item in PORTFOLIO_ITEMS:
        score = 0
        item_techs = [t.lower() for t in item.technologies]

        # Exact skill matches
        for skill in normalized_skills:
            if any(skill in tech or tech in skill for tech in item_techs):
                score += 3
            if skill in item.problem_solved.lower() or skill in item.description.lower():
                score += 1

        # Project type alignment
        if project_type:
            if project_type.lower() in item.type.lower():
                score += 4

        # Specific domain heuristics
        if any("android" in s or "mobile" in s or "react native" in s for s in normalized_skills):
            if item.slug == "clothmatics-ai":
                score += 5
        if any("java" in s or "spring" in s or "oracle" in s or "banking" in s or "enterprise" in s for s in normalized_skills):
            if item.slug == "enterprise-financial-core":
                score += 5
        if any("ai" in s or "automation" in s or "gemini" in s or "scrape" in s for s in normalized_skills):
            if item.slug in ("jarvis-growth-engine", "clothmatics-ai"):
                score += 4

        if score > 0:
            scored_items.append((score, item))

    # Sort descending by relevance score
    scored_items.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored_items[:max_items]]


def is_skill_verified(skill: str) -> bool:
    """Check if a specific skill is in the verified skills list."""
    s_clean = skill.lower().strip()
    if any(s_clean == v.lower() or s_clean in v.lower() or v.lower() in s_clean for v in VERIFIED_SKILLS):
        return True
    words = s_clean.split()
    if words and all(any(w == v.lower() or w in v.lower() for v in VERIFIED_SKILLS) for w in words):
        return True
    return False
