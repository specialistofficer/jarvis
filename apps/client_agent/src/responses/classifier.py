"""
Response Intent Classifier.
Classifies incoming client messages into structured business intents:
INTERESTED, QUESTION, INTERVIEW, NEGOTIATION, REJECTION, SPAM, UNCLEAR.
"""
import re
from typing import Optional, List, Dict, Any
from src.models.schemas import MessageIntentResult
from src.ai.provider import get_ai_provider
from src.ai.base import AIProvider

INTENT_PATTERNS = [
    # 1. SPAM / SCAMS
    ("SPAM", [
        r"\b(join\s+our\s+telegram|whatsapp\s+group|crypto\s+pump|send\s+\d+(\.\d+)?\s*(eth|usdt|btc))\b",
        r"\b(earn\s+\$\d+\s*(\/|per)\s*(day|hour)\s+clicking|gift\s*card|free\s+money)\b",
        r"\b(contact\s+manager\s+on\s+telegram|dm\s+on\s+whatsapp\s+for\s+payment)\b",
    ]),
    # 2. INTERVIEW / CALL INVITATION
    ("INTERVIEW", [
        r"\b(schedule\s+(a\s+)?(call|chat|interview|meeting)|jump\s+on\s+a\s+(call|zoom|meet|teams))\b",
        r"\b(available\s+for\s+(a\s+)?(quick\s+)?(call|chat|interview|google\s+meet|zoom))\b",
        r"\b(when\s+can\s+we\s+(talk|speak|meet)|set\s+up\s+a\s+time|calendar\s+link|calendly)\b",
    ]),
    # 3. NEGOTIATION / PRICING
    ("NEGOTIATION", [
        r"\b(rate\s+is\s+too\s+high|can\s+you\s+do\s+\$\d+|lower\s+your\s+price|best\s+price)\b",
        r"\b(discount|negotiate|budget\s+is\s+tight|can\s+we\s+do\s+it\s+for\s+less)\b",
        r"\b(hourly\s+rate\s+flexibility|fixed\s+price\s+discount)\b",
    ]),
    # 4. REJECTION
    ("REJECTION", [
        r"\b((went|go|decided\s+to\s+go)\s+with\s+another\s+(candidate|freelancer|developer)|chosen\s+someone\s+else|position\s+is\s+filled)\b",
        r"\b(not\s+moving\s+forward|decided\s+to\s+pass|no\s+longer\s+available|closing\s+the\s+job)\b",
        r"\b(hired\s+another\s+freelancer|not\s+a\s+good\s+fit\s+at\s+this\s+time)\b",
    ]),
    # 5. GENERAL INTEREST
    ("INTERESTED", [
        r"\b(liked\s+your\s+proposal|impressive\s+profile|want\s+to\s+hire\s+you|let['’]s\s+work\s+together)\b",
        r"\b(when\s+can\s+you\s+start|ready\s+to\s+move\s+forward|send\s+an\s+offer|send\s+contract)\b",
        r"\b(we\s+are\s+interested|looks\s+great|let['’]s\s+proceed)\b",
    ]),
    # 6. TECHNICAL / SCOPE QUESTION
    ("QUESTION", [
        r"\b(do\s+you\s+have\s+experience\s+with|how\s+would\s+you\s+(handle|build|architect|solve))\b",
        r"\b(can\s+you\s+explain|what\s+is\s+your\s+experience\s+in|have\s+you\s+worked\s+with)\b",
        r"\b(could\s+you\s+clarify|how\s+long\s+would\s+it\s+take|what\s+tech\s+stack)\b",
        r"\?",
    ]),
]


class ResponseIntentClassifier:
    """Classifies client communications with transparent reasoning and confidence scoring."""

    def __init__(self, ai_provider: Optional[AIProvider] = None):
        self.ai_provider = ai_provider or get_ai_provider()

    def classify(self, text: str) -> MessageIntentResult:
        """
        Classifies incoming client message into one of 7 categories.
        """
        clean_text = text.strip().lower()

        # Check pattern rules in order of priority (Spam -> Interview -> Negotiation -> Rejection -> Question -> Interested)
        for intent, patterns in INTENT_PATTERNS:
            for pattern in patterns:
                if re.search(pattern, clean_text):
                    confidence = 0.90 if intent in ["SPAM", "INTERVIEW", "REJECTION"] else 0.85
                    return MessageIntentResult(
                        intent=intent,  # type: ignore
                        confidence=confidence,
                        reasoning=f"Matched high-confidence indicator for {intent}.",
                    )

        # Fallback to UNCLEAR if very short or no match
        if len(clean_text.split()) < 3:
            return MessageIntentResult(
                intent="UNCLEAR",
                confidence=0.50,
                reasoning="Text is brief or ambiguous; requires human interpretation.",
            )

        return MessageIntentResult(
            intent="UNCLEAR",
            confidence=0.60,
            reasoning="No definitive keyword patterns matched; reviewed as ambiguous client message.",
        )
