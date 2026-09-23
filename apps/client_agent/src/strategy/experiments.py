"""A/B Testing and Strategy Optimization Engine."""

import hashlib
import logging
from typing import Dict, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from src.models.entities import ApplicationModel, ProposalModel, MessageModel
from src.models.schemas import ExperimentReport, ExperimentVariant, StrategyReviewReport
from src.analytics.roi import calculate_roi

logger = logging.getLogger(__name__)

# Active experiments catalog
EXPERIMENT_DEFINITIONS = {
    "exp_proposal_style": {
        "name": "Proposal Structure A/B Test",
        "dimension": "proposal_style",
        "variants": ["solution_first", "portfolio_first", "concise"],
        "default": "solution_first",
    }
}


def assign_variant(experiment_id: str, seed_key: str) -> str:
    """Deterministically assign an experiment variant using SHA-256 hash."""
    exp = EXPERIMENT_DEFINITIONS.get(experiment_id)
    if not exp:
        return "solution_first"

    variants = exp["variants"]
    hash_digest = hashlib.sha256(f"{experiment_id}:{seed_key}".encode("utf-8")).hexdigest()
    index = int(hash_digest, 16) % len(variants)
    return variants[index]


async def evaluate_proposal_style_experiment(session: AsyncSession) -> ExperimentReport:
    """Evaluate performance of different proposal writing strategies."""
    stmt = (
        select(ProposalModel)
        .options(
            selectinload(ProposalModel.application).selectinload(ApplicationModel.messages)
        )
    )
    result = await session.execute(stmt)
    proposals = result.scalars().all()

    variants_data: Dict[str, Dict] = {
        "solution_first": {"applications": 0, "replies": 0, "wins": 0},
        "portfolio_first": {"applications": 0, "replies": 0, "wins": 0},
        "concise": {"applications": 0, "replies": 0, "wins": 0},
    }

    for p in proposals:
        strat = p.strategy if p.strategy in variants_data else "solution_first"
        app = p.application
        if not app:
            continue

        variants_data[strat]["applications"] += 1
        has_reply = any(m.sender == "client" for m in app.messages)
        if has_reply:
            variants_data[strat]["replies"] += 1
        if app.status == "won":
            variants_data[strat]["wins"] += 1

    variant_objs: List[ExperimentVariant] = []
    best_variant: Optional[str] = None
    best_score = -1.0

    for name, stats in variants_data.items():
        total_apps = stats["applications"]
        replies = stats["replies"]
        wins = stats["wins"]

        rep_rate = round(replies / total_apps, 4) if total_apps > 0 else 0.0
        w_rate = round(wins / total_apps, 4) if total_apps > 0 else 0.0

        # Composite score: 60% win rate + 40% reply rate
        score = (w_rate * 0.6) + (rep_rate * 0.4)
        if total_apps >= 2 and score > best_score:
            best_score = score
            best_variant = name

        variant_objs.append(
            ExperimentVariant(
                name=name,
                applications_count=total_apps,
                replies_count=replies,
                wins_count=wins,
                reply_rate=rep_rate,
                win_rate=w_rate,
            )
        )

    # Confidence heuristic based on sample size
    total_samples = sum(v.applications_count for v in variant_objs)
    confidence = min(round(total_samples / 20.0, 2), 0.95) if total_samples > 0 else 0.0

    if best_variant:
        recommendation = (
            f"Variant '{best_variant}' is outperforming with {confidence * 100:.0f}% sample confidence. "
            f"Recommend prioritizing '{best_variant}' in automated proposal drafting."
        )
    else:
        recommendation = "Collecting baseline data. Continue 3-way split testing across proposal variations."

    return ExperimentReport(
        experiment_id="exp_proposal_style",
        name="Proposal Structure A/B Test",
        dimension="proposal_style",
        variants=variant_objs,
        winning_variant=best_variant,
        confidence_level=confidence,
        recommendation=recommendation,
    )


async def generate_strategy_review(session: AsyncSession) -> StrategyReviewReport:
    """Run an automated strategic review across platforms, skills, and proposal experiments."""
    exp_report = await evaluate_proposal_style_experiment(session)
    roi_report = await calculate_roi(session)

    top_sources: List[str] = []
    underperforming_sources: List[str] = []

    for p in roi_report.platform_breakdown:
        if p.wins_count > 0 or p.win_rate >= 0.2:
            top_sources.append(p.source_id)
        elif p.applications_count >= 3 and p.wins_count == 0 and p.replies_count == 0:
            underperforming_sources.append(p.source_id)

    top_tech: List[str] = []
    for t in roi_report.tech_breakdown:
        if t.wins_count > 0 or t.win_rate >= 0.2:
            top_tech.append(t.tech)

    # Generate actionable strategic recommendations
    strategic_recommendations: List[str] = []

    if top_sources:
        strategic_recommendations.append(
            f"Double down on high-converting sources: {', '.join(top_sources)}."
        )
    if underperforming_sources:
        strategic_recommendations.append(
            f"Tighten qualification filters for low-converting sources ({', '.join(underperforming_sources)}) to conserve connects and evaluation effort."
        )
    if top_tech:
        strategic_recommendations.append(
            f"Focus high-priority outreach on verified sweet spots: {', '.join(top_tech)}."
        )
    if exp_report.winning_variant:
        strategic_recommendations.append(
            f"Standardize proposals around the winning '{exp_report.winning_variant}' format."
        )
    else:
        strategic_recommendations.append(
            "Maintain balanced variant exploration to establish statistically significant conversion patterns."
        )

    return StrategyReviewReport(
        active_experiments=[exp_report],
        top_performing_sources=top_sources,
        underperforming_sources=underperforming_sources,
        top_performing_tech_tags=top_tech,
        strategic_recommendations=strategic_recommendations,
    )
