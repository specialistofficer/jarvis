"""Platform ROI, Unit Economics, and Tech Stack Analytics."""

import json
import logging
from typing import Dict, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from src.models.entities import OpportunityModel, ApplicationModel, MessageModel
from src.models.schemas import AnalyticsROIReport, PlatformMetrics, TechStackMetrics, PricingTierMetrics

logger = logging.getLogger(__name__)

EXCHANGE_RATE_USD_INR = 85.0

KEY_TECH_TAGS = [
    ("Java / Spring Boot", ["java", "spring", "spring boot", "jvm", "backend"]),
    ("React / Web Frontend", ["react", "typescript", "javascript", "frontend", "next.js"]),
    ("Android / Mobile", ["android", "mobile", "react native", "google play", "kotlin"]),
    ("AI / LLM Integration", ["ai", "llm", "gemini", "openai", "agent", "prompt engineering", "langchain"]),
    ("Python / FastAPI", ["python", "fastapi", "django", "flask"]),
]


async def calculate_roi(session: AsyncSession) -> AnalyticsROIReport:
    """Calculate comprehensive ROI, platform profitability, and tech stack distribution."""
    # Load all opportunities with applications and messages
    stmt = (
        select(OpportunityModel)
        .options(
            selectinload(OpportunityModel.applications).selectinload(ApplicationModel.messages)
        )
    )
    result = await session.execute(stmt)
    opportunities = result.scalars().all()

    total_spend_usd = 0.0
    pipeline_value_usd = 0.0
    won_revenue_usd = 0.0

    # Source aggregation structures
    source_stats: Dict[str, Dict] = {}
    # Tech tag aggregation structures
    tech_stats: Dict[str, Dict] = {
        name: {"opportunities": 0, "applications": 0, "wins": 0, "revenue": 0.0}
        for name, _ in KEY_TECH_TAGS
    }
    # Pricing tier aggregation structures
    tier_stats: Dict[str, Dict] = {
        "<$1k": {"opportunities": 0, "applications": 0, "wins": 0, "revenue": 0.0},
        "$1k-$5k": {"opportunities": 0, "applications": 0, "wins": 0, "revenue": 0.0},
        "$5k+": {"opportunities": 0, "applications": 0, "wins": 0, "revenue": 0.0},
        "hourly": {"opportunities": 0, "applications": 0, "wins": 0, "revenue": 0.0},
    }

    for opp in opportunities:
        src = opp.source or "unknown"
        if src not in source_stats:
            source_stats[src] = {
                "opportunities": 0,
                "applications": 0,
                "replies": 0,
                "wins": 0,
                "cost_usd": 0.0,
                "pipeline_usd": 0.0,
                "won_usd": 0.0,
            }

        source_stats[src]["opportunities"] += 1

        # Determine pricing tier
        b_val = opp.budget_max or opp.budget_min or 0.0
        opp_text_lower = f"{opp.title} {opp.description}".lower()
        if "hour" in opp_text_lower or (0.0 < b_val <= 150.0):
            tier = "hourly"
        elif b_val >= 5000:
            tier = "$5k+"
        elif b_val >= 1000:
            tier = "$1k-$5k"
        else:
            tier = "<$1k"
        tier_stats[tier]["opportunities"] += 1

        # Match tech tags
        skills_raw = opp.required_skills_json or "[]"
        try:
            opp_skills = [s.lower() for s in json.loads(skills_raw)]
        except Exception:
            opp_skills = []
        opp_text = f"{opp.title} {opp.description}".lower()

        matched_tech_categories = []
        for cat_name, keywords in KEY_TECH_TAGS:
            if any(k in opp_skills or k in opp_text for k in keywords):
                matched_tech_categories.append(cat_name)
                tech_stats[cat_name]["opportunities"] += 1

        for app in opp.applications:
            is_submitted = app.status in ["submitted", "won", "lost"] or app.submitted_at is not None
            has_client_reply = any(m.sender == "client" for m in app.messages)
            is_won = app.status == "won"

            # Value computations
            price = app.proposed_price or opp.budget_max or opp.budget_min or 0.0
            rev = app.actual_revenue if (is_won and app.actual_revenue is not None) else (price if is_won else 0.0)

            if is_submitted:
                source_stats[src]["applications"] += 1
                tier_stats[tier]["applications"] += 1
                for cat in matched_tech_categories:
                    tech_stats[cat]["applications"] += 1

                # Cost
                cost = opp.application_cost or 0.0
                source_stats[src]["cost_usd"] += cost
                total_spend_usd += cost

            if has_client_reply:
                source_stats[src]["replies"] += 1

            if is_won:
                source_stats[src]["wins"] += 1
                source_stats[src]["won_usd"] += rev
                tier_stats[tier]["wins"] += 1
                tier_stats[tier]["revenue"] += rev
                for cat in matched_tech_categories:
                    tech_stats[cat]["wins"] += 1
                    tech_stats[cat]["revenue"] += rev
                won_revenue_usd += rev
            elif app.status in ["draft", "pending_approval", "approved", "submitted"]:
                pipeline_value_usd += price
                source_stats[src]["pipeline_usd"] += price

    total_spend_inr = round(total_spend_usd * EXCHANGE_RATE_USD_INR, 2)
    net_profit_usd = round(won_revenue_usd - total_spend_usd, 2)
    overall_roi_percent = (
        round((won_revenue_usd - total_spend_usd) / total_spend_usd * 100.0, 2)
        if total_spend_usd > 0
        else (100.0 if won_revenue_usd > 0 else 0.0)
    )

    # Format Platform breakdown
    platform_breakdown: List[PlatformMetrics] = []
    for src, data in source_stats.items():
        apps_cnt = data["applications"]
        wins_cnt = data["wins"]
        win_rate = round(wins_cnt / apps_cnt, 4) if apps_cnt > 0 else 0.0
        c_usd = data["cost_usd"]
        w_usd = data["won_usd"]
        roi_p = (
            round((w_usd - c_usd) / c_usd * 100.0, 2)
            if c_usd > 0
            else (100.0 if w_usd > 0 else 0.0)
        )

        platform_breakdown.append(
            PlatformMetrics(
                source_id=src,
                opportunities_count=data["opportunities"],
                applications_count=apps_cnt,
                replies_count=data["replies"],
                wins_count=wins_cnt,
                total_cost_usd=round(c_usd, 2),
                total_cost_inr=round(c_usd * EXCHANGE_RATE_USD_INR, 2),
                pipeline_value_usd=round(data["pipeline_usd"], 2),
                won_revenue_usd=round(w_usd, 2),
                win_rate=win_rate,
                roi_percent=roi_p,
            )
        )

    # Format Tech breakdown
    tech_breakdown: List[TechStackMetrics] = []
    for cat_name, data in tech_stats.items():
        apps_cnt = data["applications"]
        wins_cnt = data["wins"]
        win_rate = round(wins_cnt / apps_cnt, 4) if apps_cnt > 0 else 0.0
        tech_breakdown.append(
            TechStackMetrics(
                tech=cat_name,
                opportunities_count=data["opportunities"],
                applications_count=apps_cnt,
                wins_count=wins_cnt,
                win_rate=win_rate,
                revenue_usd=round(data["revenue"], 2),
            )
        )

    # Format Pricing tier breakdown
    pricing_tier_breakdown: List[PricingTierMetrics] = []
    for tier_name, data in tier_stats.items():
        pricing_tier_breakdown.append(
            PricingTierMetrics(
                tier=tier_name,
                opportunities_count=data["opportunities"],
                applications_count=data["applications"],
                wins_count=data["wins"],
                revenue_usd=round(data["revenue"], 2),
            )
        )

    return AnalyticsROIReport(
        total_spend_usd=round(total_spend_usd, 2),
        total_spend_inr=total_spend_inr,
        pipeline_value_usd=round(pipeline_value_usd, 2),
        won_revenue_usd=round(won_revenue_usd, 2),
        net_profit_usd=net_profit_usd,
        overall_roi_percent=overall_roi_percent,
        platform_breakdown=platform_breakdown,
        tech_breakdown=tech_breakdown,
        pricing_tier_breakdown=pricing_tier_breakdown,
    )
