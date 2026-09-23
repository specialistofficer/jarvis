"""
Interactive Telegram Bot Service for Client Acquisition Agent.
Provides real-time interactive alerts with inline action buttons ([APPLY], [SKIP], [VIEW PROPOSAL]),
strict approval workflows, and command management for the founder (Chirag).
"""
import html
import json
import logging
from typing import Optional, Dict, Any, List
import httpx
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from src.config import settings
from src.models.entities import OpportunityModel, OpportunityScoreModel, ApplicationModel, ProposalModel
from src.audit.logger import record_audit_event

logger = logging.getLogger("jarvis.telegram")


class TelegramBotService:
    """
    Manages Telegram communication, notifications, and interactive callback query routing.
    In testing environment or when token is unset, operates in safe mock mode without external network calls.
    """

    def __init__(
        self,
        token: Optional[str] = None,
        chat_id: Optional[str] = None,
        http_client: Optional[httpx.AsyncClient] = None,
    ):
        self.token = token or settings.TELEGRAM_BOT_TOKEN
        self.chat_id = chat_id or settings.TELEGRAM_CHAT_ID
        self.http_client = http_client
        self.sent_messages: List[Dict[str, Any]] = []

    @property
    def is_configured(self) -> bool:
        return bool(self.token and self.chat_id and settings.ENVIRONMENT != "testing")

    async def send_message(
        self,
        text: str,
        chat_id: Optional[str] = None,
        reply_markup: Optional[Dict[str, Any]] = None,
        parse_mode: str = "HTML",
    ) -> Dict[str, Any]:
        """Send a message to founder Telegram chat."""
        target_chat_id = chat_id or self.chat_id or "default_chat"
        payload = {
            "chat_id": target_chat_id,
            "text": text,
            "parse_mode": parse_mode,
        }
        if reply_markup:
            payload["reply_markup"] = reply_markup

        # Safe mock in testing or unconfigured environments
        if not self.is_configured:
            logger.info("Telegram Mock: Message queued for %s: %s", target_chat_id, text[:60])
            self.sent_messages.append(payload)
            return {"ok": True, "result": {"message_id": len(self.sent_messages), **payload}}

        url = f"https://api.telegram.org/bot{self.token}/sendMessage"
        client = self.http_client or httpx.AsyncClient(timeout=10.0)
        try:
            resp = await client.post(url, json=payload)
            return resp.json()
        except Exception as e:
            logger.error("Failed to send Telegram message: %s", e)
            return {"ok": False, "error": str(e)}

    async def edit_message_text(
        self,
        text: str,
        chat_id: str,
        message_id: int,
        reply_markup: Optional[Dict[str, Any]] = None,
        parse_mode: str = "HTML",
    ) -> Dict[str, Any]:
        """Edit an existing message."""
        payload = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text,
            "parse_mode": parse_mode,
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup

        if not self.is_configured:
            logger.info("Telegram Mock: Edited message %s: %s", message_id, text[:60])
            self.sent_messages.append({"action": "edit", **payload})
            return {"ok": True, "result": payload}

        url = f"https://api.telegram.org/bot{self.token}/editMessageText"
        client = self.http_client or httpx.AsyncClient(timeout=10.0)
        try:
            resp = await client.post(url, json=payload)
            return resp.json()
        except Exception as e:
            logger.error("Failed to edit Telegram message: %s", e)
            return {"ok": False, "error": str(e)}

    async def answer_callback_query(
        self,
        callback_query_id: str,
        text: Optional[str] = None,
        show_alert: bool = False,
    ) -> Dict[str, Any]:
        """Acknowledge Telegram callback query button click."""
        payload = {
            "callback_query_id": callback_query_id,
            "text": text or "Action processed",
            "show_alert": show_alert,
        }
        if not self.is_configured:
            return {"ok": True, "result": payload}

        url = f"https://api.telegram.org/bot{self.token}/answerCallbackQuery"
        client = self.http_client or httpx.AsyncClient(timeout=10.0)
        try:
            resp = await client.post(url, json=payload)
            return resp.json()
        except Exception as e:
            logger.error("Failed to answer callback query: %s", e)
            return {"ok": False, "error": str(e)}

    def format_opportunity_alert(
        self,
        opp: OpportunityModel,
        score: Optional[OpportunityScoreModel] = None,
        application: Optional[ApplicationModel] = None,
    ) -> Tuple[str, Dict[str, Any]]:
        """Format an opportunity alert with rich information and inline action buttons."""
        budget_str = "Unspecified"
        if opp.budget_max and opp.budget_min:
            budget_str = f"${opp.budget_min:,.0f} - ${opp.budget_max:,.0f} {opp.currency}"
        elif opp.budget_max:
            budget_str = f"${opp.budget_max:,.0f} {opp.currency}"
        elif opp.budget_min:
            budget_str = f"${opp.budget_min:,.0f} {opp.currency}"

        fit_display = f"{score.fit_score:.1f}%" if score else "Pending"
        tech_display = f"{score.technical_match:.1f}%" if score else "N/A"
        portfolio_display = f"{score.portfolio_match:.1f}%" if score else "N/A"
        risk_display = f"{score.risk_score:.1f}%" if score else "0%"
        action_rec = score.recommended_action if score else "REVIEW"

        client_parts = []
        if opp.client_name:
            client_parts.append(opp.client_name)
        if opp.client_country:
            client_parts.append(opp.client_country)
        if opp.client_rating:
            client_parts.append(f"⭐ {opp.client_rating:.1f}")
        if opp.client_spend:
            client_parts.append(f"💰 ${opp.client_spend:,.0f}")
        client_info = " | ".join(client_parts) if client_parts else "New / Unverified Client"

        safe_title = html.escape(opp.title)
        safe_source = html.escape(opp.source.title())

        text = f"""🎯 <b>High-Relevance Opportunity Discovered</b>

📌 <b>Title:</b> {safe_title}
🏷️ <b>Source:</b> {safe_source} | <b>Budget:</b> {budget_str}
👤 <b>Client:</b> {html.escape(client_info)}

📊 <b>Evaluation:</b>
• <b>Overall Fit:</b> <b>{fit_display}</b> (Recommendation: <code>{action_rec}</code>)
• <b>Tech Match:</b> {tech_display} | <b>Portfolio:</b> {portfolio_display}
• <b>Risk Score:</b> {risk_display}
• <b>Application Cost:</b> ${opp.application_cost:.2f} USD"""

        if score and score.recommended_strategy:
            text += f"\n💡 <b>Strategy:</b> <code>{score.recommended_strategy}</code>"

        # Build inline action buttons
        buttons = []
        app_id = application.id if application else ""
        if app_id:
            buttons.append([
                {"text": "✅ Approve & Apply", "callback_data": f"apply:{app_id}"},
                {"text": "🔍 View Proposal", "callback_data": f"view_prop:{app_id}"},
            ])
            buttons.append([
                {"text": "🌐 Open Job Post", "url": opp.url},
                {"text": "❌ Skip", "callback_data": f"skip:{app_id}"},
            ])
        else:
            buttons.append([
                {"text": "🌐 Open Job Post", "url": opp.url},
                {"text": "⚡ Score & Propose", "callback_data": f"propose:{opp.id}"},
            ])

        reply_markup = {"inline_keyboard": buttons}
        return text, reply_markup

    async def send_opportunity_alert(
        self,
        opp: OpportunityModel,
        score: Optional[OpportunityScoreModel] = None,
        application: Optional[ApplicationModel] = None,
        chat_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send formatted opportunity notification to founder."""
        text, reply_markup = self.format_opportunity_alert(
            opp=opp,
            score=score,
            application=application,
        )
        return await self.send_message(
            text=text,
            chat_id=chat_id,
            reply_markup=reply_markup,
        )

    async def handle_callback_query(
        self,
        callback_query: Dict[str, Any],
        session: AsyncSession,
    ) -> Dict[str, Any]:
        """
        Handle button clicks from interactive inline keyboards.
        Supported callbacks:
        - `apply:<app_id>`: Approves proposal for submission.
        - `skip:<app_id>`: Skips opportunity and marks rejected.
        - `view_prop:<app_id>`: Displays full cover letter in chat.
        """
        query_id = callback_query.get("id", "")
        data = callback_query.get("data", "")
        message = callback_query.get("message", {})
        message_id = message.get("message_id")
        chat_id = str(message.get("chat", {}).get("id", self.chat_id or ""))

        parts = data.split(":", 1)
        action = parts[0]
        entity_id = parts[1] if len(parts) > 1 else ""

        if action == "apply":
            # Founder approved proposal
            app_stmt = (
                select(ApplicationModel)
                .options(selectinload(ApplicationModel.opportunity))
                .where(ApplicationModel.id == entity_id)
                .limit(1)
            )
            app_res = await session.execute(app_stmt)
            application = app_res.scalars().first()

            if not application:
                await self.answer_callback_query(query_id, "Application not found", show_alert=True)
                return {"ok": False, "error": "Application not found"}

            application.status = "approved"
            await record_audit_event(
                session=session,
                event_type="proposal_approved",
                entity_type="application",
                entity_id=application.id,
                details={
                    "approved_by": "founder_telegram",
                    "opportunity_id": application.opportunity_id,
                    "submission_url": application.submission_url,
                },
            )
            await session.commit()

            # Edit message status banner
            if message_id:
                new_text = message.get("text", "") + "\n\n<b>STATUS: APPROVED BY FOUNDER ✅</b>"
                # Keep direct link button only
                markup = {"inline_keyboard": [[{"text": "🌐 Open Submission Link", "url": application.submission_url or "#"}]]}
                await self.edit_message_text(new_text, chat_id, message_id, reply_markup=markup)

            await self.answer_callback_query(query_id, "✅ Application approved! Ready for manual submission.", show_alert=True)
            return {"ok": True, "action": "applied", "application_id": application.id}

        elif action == "skip":
            # Founder skipped / rejected
            app_stmt = (
                select(ApplicationModel)
                .options(selectinload(ApplicationModel.opportunity))
                .where(ApplicationModel.id == entity_id)
                .limit(1)
            )
            app_res = await session.execute(app_stmt)
            application = app_res.scalars().first()

            if application:
                application.status = "rejected"
                if application.opportunity:
                    application.opportunity.status = "rejected"
                await record_audit_event(
                    session=session,
                    event_type="application_rejected",
                    entity_type="application",
                    entity_id=application.id,
                    details={"rejected_by": "founder_telegram"},
                )
                await session.commit()

            if message_id:
                new_text = message.get("text", "") + "\n\n<b>STATUS: SKIPPED / REJECTED ❌</b>"
                await self.edit_message_text(new_text, chat_id, message_id, reply_markup={"inline_keyboard": []})

            await self.answer_callback_query(query_id, "❌ Opportunity skipped.")
            return {"ok": True, "action": "skipped"}

        elif action == "view_prop":
            # Show full cover letter
            prop_stmt = (
                select(ProposalModel)
                .where(ProposalModel.application_id == entity_id)
                .order_by(ProposalModel.version.desc())
                .limit(1)
            )
            prop_res = await session.execute(prop_stmt)
            proposal = prop_res.scalars().first()

            if not proposal:
                await self.answer_callback_query(query_id, "No proposal found for this application.", show_alert=True)
                return {"ok": False, "error": "Proposal not found"}

            prop_text = f"📝 <b>Draft Proposal (Strategy: {html.escape(proposal.strategy)}):</b>\n\n<pre>{html.escape(proposal.cover_letter)}</pre>"
            reply_markup = {
                "inline_keyboard": [
                    [{"text": "✅ Approve Now", "callback_data": f"apply:{entity_id}"}],
                ]
            }
            await self.send_message(prop_text, chat_id=chat_id, reply_markup=reply_markup)
            await self.answer_callback_query(query_id, "Proposal loaded.")
            return {"ok": True, "action": "viewed_proposal"}

        await self.answer_callback_query(query_id, "Unknown action.")
        return {"ok": False, "error": "Unknown callback action"}

    async def handle_command(
        self,
        text: str,
        chat_id: str,
        session: AsyncSession,
    ) -> Dict[str, Any]:
        """Handle incoming text commands (/start, /status, /help)."""
        cmd = text.strip().lower()

        if cmd.startswith("/start") or cmd.startswith("/help"):
            msg = """🤖 <b>Jarvis Client Acquisition Agent</b>

Commands:
/status - Current system mode, budget, and counts
/opportunities - Recent qualified opportunities
/applications - Pending applications requiring review
/help - Show this guide"""
            return await self.send_message(msg, chat_id=chat_id)

        elif cmd.startswith("/status"):
            # Fetch counts
            opps_res = await session.execute(select(OpportunityModel))
            all_opps = opps_res.scalars().all()
            total_opps = len(all_opps)
            qualified_opps = sum(1 for o in all_opps if o.status == "qualified")

            apps_res = await session.execute(select(ApplicationModel))
            all_apps = apps_res.scalars().all()
            pending_apps = sum(1 for a in all_apps if a.status == "pending_approval")

            msg = f"""⚙️ <b>Client Acquisition System Status</b>

• <b>Mode:</b> <code>{settings.DEFAULT_APPLICATION_MODE}</code>
• <b>Paid Spend:</b> <code>{settings.ALLOW_PAID_SPEND}</code> (Max: ₹{settings.MAX_COST_INR})
• <b>Auto Apply:</b> <code>{settings.AUTO_APPLY_ENABLED}</code>
• <b>Total Discovered:</b> {total_opps}
• <b>Qualified:</b> {qualified_opps}
• <b>Pending Review:</b> <b>{pending_apps}</b>"""
            return await self.send_message(msg, chat_id=chat_id)

        return await self.send_message(f"Unrecognized command: {html.escape(text)}. Send /help for options.", chat_id=chat_id)

    async def process_update(
        self,
        update: Dict[str, Any],
        session: AsyncSession,
    ) -> Dict[str, Any]:
        """Process incoming Telegram update payload from webhook or polling."""
        if "callback_query" in update:
            return await self.handle_callback_query(update["callback_query"], session)
        elif "message" in update:
            msg = update["message"]
            text = msg.get("text", "")
            chat_id = str(msg.get("chat", {}).get("id", self.chat_id or ""))
            if text.startswith("/"):
                return await self.handle_command(text, chat_id, session)

        return {"ok": True, "ignored": True}
