"""
Multi-Dimensional Opportunity Scoring Engine for Client Acquisition Agent.
Evaluates technical fit, portfolio match, client quality, value, competition, and risk.
Zero black-box calculations: every factor is transparently recorded.
"""
import re
from datetime import datetime, timezone
from typing import List, Optional, Tuple, Dict, Any

from src.profile.service import match_portfolio_items, is_skill_verified
from src.profile.owner_data import VERIFIED_SKILLS, PORTFOLIO_ITEMS

# Known keywords indicating incompatible or unverified platforms/stacks
INCOMPATIBLE_TECH_KEYWORDS = [
    "wordpress",
    "shopify",
    "magento",
    "woocommerce",
    "drupal",
    "php",
    "ruby on rails",
    "ruby",
    "swift",
    "objective-c",
    "solidity",
    "smart contract",
    "web3",
    "blockchain",
    "flutter",
]

# High-priority core skills for Chirag
CORE_STRENGTH_KEYWORDS = [
    "java",
    "spring",
    "spring boot",
    "spring mvc",
    "react",
    "react.js",
    "react native",
    "android",
    "google play",
    "rest api",
    "microservices",
    "oracle",
    "sql",
    "postgresql",
    "tomcat",
    "gemini",
    "ai integration",
    "web scraping",
    "fastapi",
    "python",
    "typescript",
]

# Risk indicators
RED_FLAG_PATTERNS = [
    (r"\b(unpaid|equity\s+only|work\s+for\s+equity|profit\s+share)\b", "Equity or unpaid work requested"),
    (r"\b(free\s+test|free\s+trial|sample\s+before\s+hire|test\s+task\s+unpaid)\b", "Demands unpaid trial or sample work"),
    (r"\b(telegram|whatsapp|skype|contact\s+me\s+at\s+[\w\.]+@)\b", "Attempting off-platform contact (scam risk)"),
    (r"\b(bypass\s+cloudflare|bypass\s+captcha|bot\s+detection\s+evasion)\b", "Requests anti-bot bypass violating terms"),
    (r"\b(casino|gambling|crypto\s+pump|porn|adult)\b", "High-risk, non-compliant or illegal domain"),
    (r"\b(urgent\s+1\s+hour|need\s+in\s+30\s+mins|easy\s+5\s+minute\s+job)\b", "Unrealistic timeline / severe scope trap"),
]

TIER_1_COUNTRIES = {
    "united states", "usa", "us",
    "united kingdom", "uk",
    "canada",
    "australia",
    "germany",
    "netherlands",
    "sweden",
    "switzerland",
    "singapore",
    "new zealand",
    "denmark",
    "norway",
}


class OpportunityScorer:
    """Calculates multi-dimensional suitability scores for discovered opportunities."""

    def extract_skills_from_text(self, text: str) -> List[str]:
        """Extract recognized tech keywords from raw job description text."""
        found_skills = []
        lower_text = text.lower()
        for skill in VERIFIED_SKILLS:
            # Word boundary search for precision
            pattern = r"\b" + re.escape(skill.lower()) + r"\b"
            if re.search(pattern, lower_text):
                found_skills.append(skill)
        return list(dict.fromkeys(found_skills))

    def calculate_technical_match(
        self,
        required_skills: List[str],
        title: str,
        description: str,
    ) -> Tuple[float, List[str], List[str], List[str]]:
        """
        Evaluate technical stack alignment.
        Returns: (score, matched_skills, missing_skills, reasons)
        """
        full_text = f"{title} {description}".lower()
        all_candidate_skills = list(required_skills)
        if len(all_candidate_skills) < 2:
            extracted = self.extract_skills_from_text(full_text)
            all_candidate_skills = list(set(all_candidate_skills + extracted))

        matched_skills: List[str] = []
        missing_skills: List[str] = []
        penalties = 0.0
        reasons: List[str] = []

        # Check for explicit incompatible technologies
        for incompatible in INCOMPATIBLE_TECH_KEYWORDS:
            if re.search(r"\b" + re.escape(incompatible) + r"\b", full_text):
                penalties += 25.0
                reasons.append(f"Incompatible technology requested: '{incompatible}'.")

        if not all_candidate_skills:
            # Generic opportunity without explicit tech
            base_score = 40.0
            reasons.append("No specific engineering skills specified.")
            final_score = max(0.0, min(100.0, base_score - penalties))
            return final_score, [], [], reasons

        for skill in all_candidate_skills:
            if is_skill_verified(skill):
                matched_skills.append(skill)
            else:
                missing_skills.append(skill)

        # Baseline ratio of verified skills
        total_req = len(all_candidate_skills)
        ratio = len(matched_skills) / total_req if total_req > 0 else 0.0
        score = ratio * 70.0  # Up to 70 base

        # Core strength bonus (up to 30 bonus points)
        core_bonus = 0.0
        for core in CORE_STRENGTH_KEYWORDS:
            if re.search(r"\b" + re.escape(core) + r"\b", full_text):
                core_bonus += 8.0
        core_bonus = min(30.0, core_bonus)
        score += core_bonus

        # Apply penalties
        score = max(0.0, min(100.0, score - penalties))

        if matched_skills:
            reasons.append(f"Verified matching skills ({len(matched_skills)}): {', '.join(matched_skills[:5])}.")
        if missing_skills:
            reasons.append(f"Unverified skills ({len(missing_skills)}): {', '.join(missing_skills[:3])}.")

        return round(score, 1), matched_skills, missing_skills, reasons

    def calculate_portfolio_match(
        self,
        required_skills: List[str],
        title: str,
        description: str,
    ) -> Tuple[float, List[str], List[str]]:
        """
        Evaluate availability of genuine, verifiable portfolio items and live proof.
        Returns: (score, matching_slugs, reasons)
        """
        full_text = f"{title} {description}".lower()
        skills = list(required_skills)
        if not skills:
            skills = self.extract_skills_from_text(full_text)

        matched_items = match_portfolio_items(skills, max_items=2)
        matching_slugs = [item.slug for item in matched_items]
        reasons: List[str] = []

        if not matched_items:
            reasons.append("No direct portfolio item matched the required tech stack.")
            return 30.0, [], reasons

        score = 60.0
        for item in matched_items:
            # Evidence bonus (Google Play app or live enterprise system)
            if item.play_store_url:
                score += 20.0
                reasons.append(f"Live Play Store app match: '{item.name}'.")
            elif item.type == "enterprise_system":
                score += 20.0
                reasons.append(f"Production enterprise architecture match: '{item.name}'.")
            else:
                score += 15.0
                reasons.append(f"Direct portfolio match: '{item.name}'.")

        final_score = min(100.0, score)
        return round(final_score, 1), matching_slugs, reasons

    def calculate_client_quality(
        self,
        client_name: Optional[str],
        client_country: Optional[str],
        client_spend: Optional[float],
        client_rating: Optional[float],
        description: str,
    ) -> Tuple[float, List[str]]:
        """
        Evaluate client trustworthiness, budget credibility, and reputation.
        Returns: (score, reasons)
        """
        score = 50.0  # Neutral baseline
        reasons: List[str] = []

        # Rating evaluation
        if client_rating is not None:
            if client_rating >= 4.8:
                score += 20.0
                reasons.append(f"Excellent client rating ({client_rating:.1f}/5.0).")
            elif client_rating >= 4.2:
                score += 10.0
                reasons.append(f"Good client rating ({client_rating:.1f}/5.0).")
            elif client_rating < 4.0:
                score -= 25.0
                reasons.append(f"Sub-par client rating ({client_rating:.1f}/5.0).")

        # Spend evaluation
        if client_spend is not None:
            if client_spend >= 10000.0:
                score += 20.0
                reasons.append(f"High-spend client (${client_spend:,.0f} verified).")
            elif client_spend >= 1000.0:
                score += 10.0
                reasons.append(f"Proven client spend (${client_spend:,.0f}).")
            elif client_spend == 0.0:
                score -= 5.0
                reasons.append("New client with no prior platform spend.")

        # Country tier
        if client_country:
            c_clean = client_country.lower().strip()
            if any(tier_c in c_clean for tier_c in TIER_1_COUNTRIES):
                score += 10.0
                reasons.append(f"Client in established market ({client_country}).")

        # Quality of description
        word_count = len(description.split())
        if word_count > 100:
            score += 10.0
        elif word_count < 25:
            score -= 15.0
            reasons.append("Vague / extremely brief job description.")

        final_score = max(10.0, min(100.0, score))
        return round(final_score, 1), reasons

    def calculate_value_score(
        self,
        budget_min: Optional[float],
        budget_max: Optional[float],
        currency: str = "USD",
    ) -> Tuple[float, List[str]]:
        """
        Evaluate compensation attractiveness relative to engineering effort.
        Returns: (score, reasons)
        """
        reasons: List[str] = []
        eff_budget = budget_max if budget_max is not None else budget_min

        if eff_budget is None:
            reasons.append("Budget unspecified (standard hourly/milestone expected).")
            return 60.0, reasons

        if eff_budget >= 3000.0:
            reasons.append(f"High-value engagement (${eff_budget:,.0f}).")
            return 95.0, reasons
        elif eff_budget >= 1500.0:
            reasons.append(f"Solid project budget (${eff_budget:,.0f}).")
            return 85.0, reasons
        elif eff_budget >= 500.0:
            reasons.append(f"Moderate project budget (${eff_budget:,.0f}).")
            return 75.0, reasons
        elif eff_budget >= 150.0:
            reasons.append(f"Small project budget (${eff_budget:,.0f}).")
            return 55.0, reasons
        elif eff_budget >= 50.0:
            reasons.append(f"Low budget task (${eff_budget:,.0f}).")
            return 35.0, reasons
        else:
            reasons.append(f"Unreasonably low budget (${eff_budget:,.0f}) for professional engineering.")
            return 15.0, reasons

    def calculate_competition_score(
        self,
        source: str,
        posted_at: Optional[datetime],
    ) -> Tuple[float, List[str]]:
        """
        Estimate proposal competition and timing advantage.
        Higher score = less competition / better odds.
        """
        reasons: List[str] = []
        score = 60.0

        # Freshness calculation
        if posted_at:
            now = datetime.now(timezone.utc)
            # Ensure timezone awareness
            if posted_at.tzinfo is None:
                posted_at = posted_at.replace(tzinfo=timezone.utc)
            age_hours = (now - posted_at).total_seconds() / 3600.0

            if age_hours <= 2.0:
                score += 25.0
                reasons.append("Just posted (< 2 hours ago). High early-bid advantage.")
            elif age_hours <= 12.0:
                score += 15.0
                reasons.append("Fresh opportunity (< 12 hours ago).")
            elif age_hours > 72.0:
                score -= 20.0
                reasons.append("Older opportunity (> 3 days). Likely saturated with proposals.")

        # Source competition profile
        src = source.lower()
        if src in ("hackernews", "remoteok", "reddit"):
            score += 10.0
            reasons.append(f"Direct sourcing on {source.title()} avoids marketplace connect bidding wars.")
        elif src == "upwork":
            score -= 5.0

        final_score = max(10.0, min(100.0, score))
        return round(final_score, 1), reasons

    def calculate_risk_score(
        self,
        title: str,
        description: str,
        budget_max: Optional[float],
        client_rating: Optional[float],
    ) -> Tuple[float, List[str]]:
        """
        Detect scam indicators, scope creep traps, and violation of platform terms.
        Higher score = HIGHER RISK.
        """
        full_text = f"{title}\n{description}"
        red_flags: List[str] = []
        risk_score = 0.0

        for pattern, warning in RED_FLAG_PATTERNS:
            if re.search(pattern, full_text, re.IGNORECASE):
                risk_score += 35.0
                red_flags.append(warning)

        # Micro budget with complex scope trap
        if budget_max is not None and budget_max < 40.0:
            if any(term in full_text.lower() for term in ["full app", "complete website", "saas", "production", "clone"]):
                risk_score += 40.0
                red_flags.append("Exploitative scope: full application requested for sub-$40 budget.")

        if client_rating is not None and client_rating < 3.5:
            risk_score += 25.0
            red_flags.append(f"Poor client feedback record ({client_rating:.1f}/5.0).")

        final_risk = min(100.0, risk_score)
        return round(final_risk, 1), red_flags

    def calculate_fit_score(
        self,
        technical_match: float,
        portfolio_match: float,
        client_quality: float,
        value_score: float,
        competition_score: float,
        risk_score: float,
    ) -> float:
        """
        Aggregate multi-factor fit score (0.0 - 100.0) with explicit transparent weighting.
        """
        weighted_sum = (
            0.35 * technical_match
            + 0.25 * portfolio_match
            + 0.15 * client_quality
            + 0.15 * value_score
            + 0.10 * competition_score
        )
        # Risk penalty: up to -40 points for 100% risk
        risk_penalty = (risk_score / 100.0) * 40.0
        final_fit = weighted_sum - risk_penalty
        return round(max(0.0, min(100.0, final_fit)), 1)

    def determine_strategy(
        self,
        technical_match: float,
        portfolio_slugs: List[str],
        title: str,
        description: str,
    ) -> str:
        """Determine the most persuasive authentic proposal strategy."""
        full_text = f"{title} {description}".lower()

        has_mobile = any(kw in full_text for kw in ["android", "play store", "react native", "mobile app", "play console"])
        has_enterprise = any(kw in full_text for kw in ["spring", "java", "banking", "enterprise", "microservice", "tomcat", "oracle", "hibernate"])
        has_ai = any(kw in full_text for kw in ["gemini", "llm", "ai ", "ai-", "automation", "scrape", "fastapi", "agent"])

        if has_enterprise:
            return "enterprise_architecture_first"
        if has_mobile:
            return "live_app_case_study"
        if has_ai:
            return "solution_demo_first"
        if "enterprise-financial-core" in portfolio_slugs:
            return "enterprise_architecture_first"
        if "clothmatics-ai" in portfolio_slugs:
            return "live_app_case_study"
        return "solution_first"
