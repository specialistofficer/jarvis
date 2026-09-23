"""
Structured Audit Logging Service for Agent Decisions and Actions.
"""
import json
import logging
from typing import Dict, Any, Optional, List
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.models.entities import AuditLogModel

logger = logging.getLogger("jarvis.audit")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler()
    formatter = logging.Formatter('{"time":"%(asctime)s", "level":"%(levelname)s", "event":%(message)s}')
    ch.setFormatter(formatter)
    logger.addHandler(ch)


async def record_audit_event(
    session: AsyncSession,
    event_type: str,
    entity_type: str,
    entity_id: str,
    details: Dict[str, Any],
) -> AuditLogModel:
    """Record an explainable event in both database audit table and structured logs."""
    details_str = json.dumps(details)
    log_entry = AuditLogModel(
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        details_json=details_str,
    )
    session.add(log_entry)
    await session.commit()

    # Log to stdout for telemetry
    log_payload = {
        "event_type": event_type,
        "entity_type": entity_type,
        "entity_id": entity_id,
        "details": details,
    }
    logger.info(json.dumps(log_payload))
    return log_entry


async def fetch_audit_logs(
    session: AsyncSession,
    entity_type: Optional[str] = None,
    event_type: Optional[str] = None,
    limit: int = 50,
) -> List[AuditLogModel]:
    """Retrieve historical audit records."""
    stmt = select(AuditLogModel).order_by(AuditLogModel.created_at.desc()).limit(limit)
    if entity_type:
        stmt = stmt.where(AuditLogModel.entity_type == entity_type)
    if event_type:
        stmt = stmt.where(AuditLogModel.event_type == event_type)

    result = await session.execute(stmt)
    return list(result.scalars().all())
