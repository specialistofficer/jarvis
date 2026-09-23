"""
Contextual Response Drafter.
Generates tailored, professional replies to client inquiries grounded in
the owner's authentic profile, timezone (Asia/Calcutta), and portfolio.
"""
from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.entities import ApplicationModel, ProposalModel, OpportunityModel, MessageModel
from src.models.schemas import ResponseDraftResult, MessageIntentResult
from src.responses.classifier import ResponseIntentClassifier
from src.profile.owner_data import PORTFOLIO_ITEMS
from src.audit.logger import record_audit_event


class ContextualResponseDrafter:
    """Drafts hyper-personalized client replies based on classified intent and application context."""

    def __init__(self, classifier: Optional[ResponseIntentClassifier] = None):
        self.classifier = classifier or ResponseIntentClassifier()

    def generate_reply_text(
        self,
        intent: str,
        incoming_text: str,
        opp_title: str,
        proposed_price: Optional[float] = None,
    ) -> Tuple[str, str, List[str]]:
        """
        Generate contextual reply, recommended action, and notes.
        Returns: (suggested_reply, recommended_action, notes)
        """
        notes: List[str] = []

        if intent == "INTERVIEW":
            reply = (
                "Hi, thank you for reaching out! I would be glad to hop on a call to discuss the requirements "
                f"for '{opp_title}'.\n\n"
                "I am based in India (IST, UTC+5:30). I have open availability tomorrow between:\n"
                "• 3:30 PM – 8:00 PM IST (which corresponds to 6:00 AM – 10:30 AM EDT / 10:00 AM – 2:30 PM UTC)\n\n"
                "Please let me know if any slot in that window works for you, or feel free to share a calendar link. "
                "Looking forward to speaking with you!"
            )
            action = "REVIEW_AND_SCHEDULE_CALL"
            notes.append("Proposes convenient overlap window between India (IST) and US/European working hours.")

        elif intent == "QUESTION":
            reply = (
                f"Hi, thanks for your question regarding '{opp_title}'.\n\n"
                "In my 10 years of hands-on software development, I have architected and deployed production systems "
                "across enterprise Java/Spring Boot backends, modern React web interfaces, and high-performance Android apps.\n\n"
                "For your specific use case, I focus on clean architecture, resilient database transactions, and comprehensive test coverage. "
                "Could you share a few more details on your timeline or existing codebase so I can provide an exact technical breakdown?"
            )
            action = "ANSWER_TECHNICAL_QUESTION"
            notes.append("Addresses technical questions with factual 10-year experience and requests clarifying requirements.")

        elif intent == "NEGOTIATION":
            target_price = f"${proposed_price:,.0f} USD" if proposed_price else "the proposed budget"
            reply = (
                f"Hi, thank you for the feedback on the proposal for '{opp_title}'.\n\n"
                f"My quote of {target_price} reflects senior-level engineering, full test coverage, and production reliability. "
                "However, I value building a long-term collaboration. If budget is tight, we can phase the project into structured milestones "
                "or adjust the initial scope so you get core deliverables within your target budget first.\n\n"
                "Let me know your preferred target number and we can structure the milestones accordingly."
            )
            action = "NEGOTIATE_MILESTONES"
            notes.append("Politely defends value while offering milestone phasing to accommodate client budget constraints.")

        elif intent == "REJECTION":
            reply = (
                f"Hi, thank you for letting me know. I appreciate your time reviewing my proposal for '{opp_title}'.\n\n"
                "Best of luck with the development and rollout! If you ever need assistance with enterprise Java, Spring Boot, "
                "React, or Android development in the future, feel free to reach back out."
            )
            action = "CLOSE_GRACIOUSLY"
            notes.append("Polite and professional sign-off maintaining future relationship potential.")

        elif intent == "SPAM":
            reply = (
                "[FLAGGED: Potential scam or TOS violation. No response recommended.]"
            )
            action = "IGNORE_AND_FLAG"
            notes.append("Detected off-platform contact request or suspicious spam phrasing.")

        elif intent == "INTERESTED":
            reply = (
                f"Hi, great to hear from you! I am ready to get started on '{opp_title}'.\n\n"
                "To ensure a smooth kickoff, I can set up the project repository, review your API specifications or design files, "
                "and share the initial delivery timeline.\n\n"
                "Please send over the contract or platform offer, and let me know if you need any initial setup details from my side."
            )
            action = "CONFIRM_AND_KICKOFF"
            notes.append("Positive confirmation and immediate onboarding next steps.")

        else:  # UNCLEAR
            reply = (
                f"Hi, thanks for reaching out regarding '{opp_title}'. "
                "Could you please share a bit more detail on your current status or questions? "
                "Happy to provide any technical details needed."
            )
            action = "REQUEST_CLARIFICATION"
            notes.append("Polite follow-up seeking clarification.")

        return reply, action, notes

    async def draft_response(
        self,
        application_id: str,
        incoming_text: str,
        session: AsyncSession,
    ) -> ResponseDraftResult:
        """
        Process an incoming client message, classify intent, draft tailored reply, and persist message.
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
        opp_title = opp.title if opp else "Software Development"

        # 1. Classify intent
        classification = self.classifier.classify(incoming_text)

        # 2. Draft contextual reply
        suggested_reply, action, notes = self.generate_reply_text(
            intent=classification.intent,
            incoming_text=incoming_text,
            opp_title=opp_title,
            proposed_price=application.proposed_price,
        )

        # 3. Store message in database
        message = MessageModel(
            application_id=application_id,
            sender="client",
            text=incoming_text,
            intent=classification.intent,
            suggested_reply=suggested_reply,
            status="received",
        )
        session.add(message)

        # 4. Record audit event
        await record_audit_event(
            session=session,
            event_type="client_response_processed",
            entity_type="application",
            entity_id=application_id,
            details={
                "intent": classification.intent,
                "confidence": classification.confidence,
                "action": action,
            },
        )
        await session.commit()

        return ResponseDraftResult(
            application_id=application_id,
            incoming_text=incoming_text,
            intent=classification.intent,
            suggested_reply=suggested_reply,
            recommended_action=action,
            notes=notes,
        )
