"""Conversion funnel calculation engine."""

import logging
from sqlalchemy import func, distinct, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from src.models.entities import OpportunityModel, OpportunityScoreModel, ApplicationModel, MessageModel
from src.models.schemas import ConversionFunnelReport, FunnelStageCount

logger = logging.getLogger(__name__)


async def calculate_funnel(session: AsyncSession) -> ConversionFunnelReport:
    """Calculate the full client acquisition conversion funnel.

    Stages:
    1. Discovered: Total job opportunities parsed across all platforms
    2. Qualified: Opportunities meeting score criteria (fit >= 65% or recommended APPLY/REVIEW)
    3. Applied: Applications prepared and submitted (or won/lost)
    4. Replied: Applications receiving client communications (interest/questions/interviews)
    5. Interview: Applications advancing to interview/call phase
    6. Won: Closed paid contracts
    """
    # 1. Total Discovered
    disc_res = await session.execute(select(func.count(OpportunityModel.id)))
    total_discovered = disc_res.scalar() or 0

    # 2. Qualified Opportunities
    qual_stmt = select(func.count(distinct(OpportunityScoreModel.opportunity_id))).where(
        or_(
            OpportunityScoreModel.recommended_action.in_(["APPLY", "REVIEW"]),
            OpportunityScoreModel.fit_score >= 0.65,
        )
    )
    qual_res = await session.execute(qual_stmt)
    qualified = qual_res.scalar() or 0

    # 3. Applied Applications
    app_stmt = select(func.count(ApplicationModel.id)).where(
        or_(
            ApplicationModel.status.in_(["submitted", "won", "lost"]),
            ApplicationModel.submitted_at.is_not(None),
        )
    )
    app_res = await session.execute(app_stmt)
    applied = app_res.scalar() or 0

    # 4. Replied Applications
    reply_stmt = select(func.count(distinct(MessageModel.application_id))).where(
        MessageModel.sender == "client"
    )
    reply_res = await session.execute(reply_stmt)
    replied = reply_res.scalar() or 0

    # 5. Interview Applications
    interview_stmt = select(func.count(distinct(MessageModel.application_id))).where(
        MessageModel.sender == "client",
        MessageModel.intent == "INTERVIEW",
    )
    interview_res = await session.execute(interview_stmt)
    interview = interview_res.scalar() or 0

    # 6. Won Contracts
    won_stmt = select(func.count(ApplicationModel.id)).where(ApplicationModel.status == "won")
    won_res = await session.execute(won_stmt)
    won = won_res.scalar() or 0

    # Build Stage Metrics
    def calc_metrics(current: int, prev: int):
        conv = round(current / prev, 4) if prev > 0 else 0.0
        drop = round(1.0 - conv, 4) if prev > 0 else 0.0
        return conv, drop

    qual_conv, qual_drop = calc_metrics(qualified, total_discovered)
    app_conv, app_drop = calc_metrics(applied, qualified)
    rep_conv, rep_drop = calc_metrics(replied, applied)
    int_conv, int_drop = calc_metrics(interview, replied)
    won_conv, won_drop = calc_metrics(won, interview)

    stages = [
        FunnelStageCount(stage="Discovered", count=total_discovered, conversion_from_previous=1.0, dropoff_rate=0.0),
        FunnelStageCount(stage="Qualified", count=qualified, conversion_from_previous=qual_conv, dropoff_rate=qual_drop),
        FunnelStageCount(stage="Applied", count=applied, conversion_from_previous=app_conv, dropoff_rate=app_drop),
        FunnelStageCount(stage="Replied", count=replied, conversion_from_previous=rep_conv, dropoff_rate=rep_drop),
        FunnelStageCount(stage="Interview", count=interview, conversion_from_previous=int_conv, dropoff_rate=int_drop),
        FunnelStageCount(stage="Won", count=won, conversion_from_previous=won_conv, dropoff_rate=won_drop),
    ]

    overall_rate = round(won / total_discovered, 4) if total_discovered > 0 else 0.0

    return ConversionFunnelReport(
        total_discovered=total_discovered,
        qualified=qualified,
        applied=applied,
        replied=replied,
        interview=interview,
        won=won,
        stages=stages,
        overall_conversion_rate=overall_rate,
    )
