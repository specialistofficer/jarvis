"""
Execution Mode Controller for Client Acquisition Agent.
Enforces the 3 execution modes (MANUAL, APPROVAL_REQUIRED, AUTO)
and guarantees strict compliance with platform terms and anti-bot rules.
"""
from typing import Dict, Any, Optional, Tuple, Literal
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.entities import ApplicationModel, OpportunityModel, ProposalModel, SourceModel
from src.models.schemas import SubmissionPackageSchema, SourceCapabilitySchema
from src.execution.packager import ApplicationPackager
from src.audit.logger import record_audit_event


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ExecutionModeController:
    """
    Controls and verifies application execution modes.
    Enforces human-in-the-loop gates and disallows terms-violating automation.
    """

    def __init__(self, packager: Optional[ApplicationPackager] = None):
        self.packager = packager or ApplicationPackager()

    def resolve_effective_mode(
        self,
        requested_mode: str,
        source_capability: Optional[SourceCapabilitySchema] = None,
    ) -> Literal["MANUAL", "APPROVAL_REQUIRED", "AUTO"]:
        """
        Determine the permitted mode based on platform capabilities and system safety settings.
        Downgrades AUTO to APPROVAL_REQUIRED or MANUAL if rules are violated.
        """
        req = requested_mode.upper()

        if req == "AUTO":
            # AUTO mode safety checks
            if not settings.AUTO_APPLY_ENABLED:
                return "APPROVAL_REQUIRED"

            if source_capability:
                if source_capability.requires_human_approval:
                    return "APPROVAL_REQUIRED"
                if not (source_capability.api_available or source_capability.browser_automation_allowed):
                    return "MANUAL"

            return "AUTO"

        elif req == "APPROVAL_REQUIRED":
            if source_capability and not (source_capability.application_supported or source_capability.api_available):
                return "MANUAL"
            return "APPROVAL_REQUIRED"

        return "MANUAL"

    async def execute_submission(
        self,
        application_id: str,
        session: AsyncSession,
    ) -> Dict[str, Any]:
        """
        Execute or package the application according to its effective mode.
        """
        app_stmt = (
            select(ApplicationModel)
            .options(
                selectinload(ApplicationModel.opportunity),
                selectinload(ApplicationModel.proposals),
            )
            .where(ApplicationModel.id == application_id)
            .limit(1)
        )
        app_res = await session.execute(app_stmt)
        application = app_res.scalars().first()

        if not application:
            raise ValueError(f"Application {application_id} not found")

        opp = application.opportunity
        if not opp:
            raise ValueError("Associated opportunity not found")

        if not application.proposals:
            raise ValueError("Cannot submit application without a generated proposal")

        latest_proposal = application.proposals[-1]
        if not latest_proposal.is_factually_verified:
            raise ValueError("BLOCKED: Proposal failed factual verification guard. Cannot submit unverified claims.")

        effective_mode = self.resolve_effective_mode(application.mode)

        # Gate check: APPROVAL_REQUIRED requires explicit founder approval
        if effective_mode == "APPROVAL_REQUIRED" and application.status != "approved":
            raise PermissionError(
                f"Application {application_id} is in APPROVAL_REQUIRED mode and has status '{application.status}'. "
                "Founder must approve before submission."
            )

        # Build 1-click manual package
        package = self.packager.build_package(
            application=application,
            proposal=latest_proposal,
            opportunity=opp,
        )

        now = utc_now()
        application.submitted_at = now
        application.status = "submitted"

        await record_audit_event(
            session=session,
            event_type="application_submitted",
            entity_type="application",
            entity_id=application.id,
            details={
                "source": opp.source,
                "mode": effective_mode,
                "submission_url": application.submission_url,
                "price": application.proposed_price,
            },
        )
        await session.commit()

        return {
            "ok": True,
            "application_id": application.id,
            "status": "submitted",
            "mode": effective_mode,
            "submitted_at": now.isoformat(),
            "package": package.model_dump(),
        }
