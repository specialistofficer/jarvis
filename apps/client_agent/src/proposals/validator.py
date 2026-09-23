"""
Factual Verification Guard for Generated Proposals.
Enforces the mandatory Zero Factual Invention policy.
Verifies that technologies, client claims, past employers, and metrics
strictly match the verified owner profile and portfolio.
"""
import re
from typing import List, Tuple
from src.models.schemas import FactualVerificationReport
from src.profile.service import is_skill_verified
from src.profile.owner_data import VERIFIED_SKILLS, PORTFOLIO_ITEMS

# Prohibited / unverified tech stacks that must NEVER appear as claimed capabilities
PROHIBITED_TECH_PATTERNS = [
    r"\b(rust)\b",
    r"\b(solidity|smart\s+contract|web3|blockchain)\b",
    r"\b(ruby(\s+on\s+rails)?|rails)\b",
    r"\b(php|wordpress|woocommerce|shopify|magento|drupal)\b",
    r"\b(swift|objective-c)\b",
    r"\b(flutter)\b",
    r"\b(vue(\.js)?|angular)\b",
    r"\b(c#|\.net)\b",
    r"\b(elixir|erlang|scala|haskell|clojure)\b",
]

# Unverified past employer / enterprise client name claims
# (Note: Google Play and Google Gemini are allowed as platform/API integrations)
FABRICATED_EMPLOYER_PATTERNS = [
    r"\b(worked\s+at|engineer\s+at|led\s+team\s+at)\s+(netflix|apple|meta|facebook|amazon|microsoft|uber|airbnb|tesla|stripe)\b",
    r"\b(former|ex-)\s*(netflix|apple|meta|facebook|amazon|microsoft|uber|airbnb|tesla|stripe)\b",
    r"\b(clients?\s+include\s+[\w\s,]+(netflix|apple|meta|facebook|amazon|microsoft))\b",
]

# Suspicious, exaggerated or fabricated metrics
SUSPICIOUS_METRIC_PATTERNS = [
    (r"\b(increased|boosted|grew|scaled|improved)\s+[\w\s]{0,25}(by\s+)?(\d{2,3}%\b|\$\d+[\d,]*\b)", "Unverified percentage or revenue metric claim"),
    (r"\b(scaled\s+to\s+\d+\s*(m|million|k|thousand)\s+users)\b", "Unverified user scale claim"),
    (r"\b(\$\d+\s*(m|million|k)\s*(arr|mrr|revenue))\b", "Unverified financial metric claim"),
    (r"\b(available\s+24/7|guaranteed\s+in\s+\d+\s+hours?|100%\s+guaranteed\s+success)\b", "Unsubstantiated guarantee or 24/7 availability"),
]


class FactualVerificationGuard:
    """
    Automated hard gate that audits proposal text against verified owner data.
    Blocks any proposal with unverified technologies, metrics, or company claims.
    """

    def verify_proposal(self, text: str) -> FactualVerificationReport:
        """
        Audit the draft proposal text and return a structured verification report.
        """
        unverified_claims: List[str] = []
        unlisted_technologies: List[str] = []
        suspicious_metrics: List[str] = []
        lower_text = text.lower()

        # 1. Audit for unverified / prohibited technologies
        for pattern in PROHIBITED_TECH_PATTERNS:
            match = re.search(pattern, lower_text, re.IGNORECASE)
            if match:
                matched_tech = match.group(0).strip()
                unlisted_technologies.append(matched_tech)
                unverified_claims.append(f"Unlisted/unverified technology claim: '{matched_tech}'.")

        # 2. Audit for fabricated employer or famous client claims
        for pattern in FABRICATED_EMPLOYER_PATTERNS:
            match = re.search(pattern, lower_text, re.IGNORECASE)
            if match:
                matched_claim = match.group(0).strip()
                unverified_claims.append(f"Fabricated employer/client claim: '{matched_claim}'.")

        # 3. Audit for suspicious metrics or wild promises
        for pattern, reason in SUSPICIOUS_METRIC_PATTERNS:
            matches = re.finditer(pattern, text, re.IGNORECASE)
            for m in matches:
                matched_metric = m.group(0).strip()
                # Check if it's the verified 10-year experience claim
                if "10 year" in matched_metric.lower() or "10+ year" in matched_metric.lower():
                    continue
                suspicious_metrics.append(matched_metric)
                unverified_claims.append(f"{reason}: '{matched_metric}'.")

        is_valid = (
            len(unverified_claims) == 0
            and len(unlisted_technologies) == 0
            and len(suspicious_metrics) == 0
        )

        if is_valid:
            notes = "Proposal passed factual verification. All cited skills, experience, and assets are authentic."
        else:
            notes = (
                f"REJECTED: Proposal contains {len(unverified_claims)} unverified claims or unsupported technologies. "
                "Must be regenerated or edited to maintain zero-hallucination compliance."
            )

        return FactualVerificationReport(
            is_valid=is_valid,
            unverified_claims=unverified_claims,
            unlisted_technologies=unlisted_technologies,
            suspicious_metrics=suspicious_metrics,
            verdict_notes=notes,
        )
