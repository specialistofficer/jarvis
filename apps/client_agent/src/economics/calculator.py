"""
Application Economics Engine for Client Acquisition Agent.
Calculates connects cost in INR/USD, platform commission rates,
expected monetary value (EV = Net_Budget * P(win) - Cost), and risk discounts.
"""
from typing import Optional, List, Tuple, Literal
from src.config import settings
from src.models.schemas import EconomicsEvaluationSchema

UPWORK_CONNECT_COST_USD: float = 0.15

DEFAULT_PLATFORM_FEES = {
    "upwork": 0.10,       # 10% freelancer fee
    "freelancer": 0.10,   # 10%
    "remoteok": 0.0,      # Direct employer
    "hackernews": 0.0,    # Direct employer
    "reddit": 0.0,        # Direct client
}


class ApplicationEconomicsCalculator:
    """
    Computes exact costs, fee deductions, win probability,
    and Expected Monetary Value (EV) for potential client proposals.
    """

    def __init__(
        self,
        allow_paid_spend: Optional[bool] = None,
        max_cost_inr: Optional[float] = None,
        usd_to_inr: Optional[float] = None,
    ):
        self.allow_paid_spend = (
            allow_paid_spend if allow_paid_spend is not None else settings.ALLOW_PAID_SPEND
        )
        self.max_cost_inr = (
            max_cost_inr if max_cost_inr is not None else settings.MAX_COST_INR
        )
        self.usd_to_inr = (
            usd_to_inr if usd_to_inr is not None else settings.USD_TO_INR_RATE
        )

    def calculate_cost(
        self,
        source: str,
        connects: Optional[int] = None,
        explicit_cost_usd: Optional[float] = None,
    ) -> Tuple[float, float]:
        """
        Calculate application cost in USD and INR.
        Returns: (cost_usd, cost_inr)
        """
        if explicit_cost_usd is not None and explicit_cost_usd > 0.0:
            cost_usd = round(explicit_cost_usd, 2)
        elif connects is not None and connects > 0:
            cost_usd = round(connects * UPWORK_CONNECT_COST_USD, 2)
        elif source.lower() == "upwork":
            # Default estimated connects for Upwork jobs if unknown
            cost_usd = round(8 * UPWORK_CONNECT_COST_USD, 2)
        else:
            cost_usd = 0.0

        cost_inr = round(cost_usd * self.usd_to_inr, 2)
        return cost_usd, cost_inr

    def get_platform_fee_rate(self, source: str) -> float:
        """Returns the platform commission fee rate (e.g. 0.10 for 10%)."""
        src = source.lower().strip()
        for known_src, fee in DEFAULT_PLATFORM_FEES.items():
            if known_src in src:
                return fee
        return 0.0

    def estimate_gross_budget(
        self,
        budget_min: Optional[float],
        budget_max: Optional[float],
        default_fallback: float = 300.0,
    ) -> float:
        """Estimate project gross budget from min/max bounds."""
        if budget_min is not None and budget_max is not None:
            if budget_max >= budget_min and budget_min > 0:
                return round((budget_min + budget_max) / 2.0, 2)
            return round(max(budget_min, budget_max), 2)
        if budget_max is not None and budget_max > 0:
            return round(budget_max, 2)
        if budget_min is not None and budget_min > 0:
            return round(budget_min, 2)
        return default_fallback

    def estimate_win_probability(
        self,
        fit_score: float,
        competition_score: float = 50.0,
        client_quality: float = 50.0,
        has_matching_portfolio: bool = False,
    ) -> float:
        """
        Estimate win probability (0.01 - 0.50) based on fit, competition, client quality, and live portfolio.
        """
        base = (fit_score / 100.0) * 0.25
        comp_adj = (competition_score / 100.0) * 0.10
        client_adj = (client_quality / 100.0) * 0.05
        portfolio_boost = 0.05 if has_matching_portfolio else 0.0

        raw_prob = base + comp_adj + client_adj + portfolio_boost
        return round(max(0.01, min(0.50, raw_prob)), 4)

    def evaluate(
        self,
        source: str,
        budget_min: Optional[float],
        budget_max: Optional[float],
        fit_score: float,
        competition_score: float = 50.0,
        client_quality: float = 50.0,
        risk_score: float = 0.0,
        has_matching_portfolio: bool = False,
        connects: Optional[int] = None,
        explicit_cost_usd: Optional[float] = None,
    ) -> EconomicsEvaluationSchema:
        """
        Perform complete economics evaluation and return structured metrics.
        """
        cost_usd, cost_inr = self.calculate_cost(
            source=source,
            connects=connects,
            explicit_cost_usd=explicit_cost_usd,
        )

        # Spend permission verification
        if cost_inr <= 0.0:
            is_spend_permitted = True
        else:
            is_spend_permitted = self.allow_paid_spend and (cost_inr <= self.max_cost_inr)

        gross_budget = self.estimate_gross_budget(budget_min, budget_max)
        fee_rate = self.get_platform_fee_rate(source)
        net_revenue = round(gross_budget * (1.0 - fee_rate), 2)

        # Risk discount factor (1.0 = no risk, 0.4 = high risk)
        risk_discount = round(max(0.2, min(1.0, 1.0 - (risk_score / 100.0) * 0.6)), 2)
        adjusted_revenue = round(net_revenue * risk_discount, 2)

        p_win = self.estimate_win_probability(
            fit_score=fit_score,
            competition_score=competition_score,
            client_quality=client_quality,
            has_matching_portfolio=has_matching_portfolio,
        )

        # Expected Monetary Value = (Risk-Adjusted Net Revenue * P(win)) - Cost
        expected_monetary_value = round((adjusted_revenue * p_win) - cost_usd, 2)

        # ROI Ratio
        if cost_usd > 0:
            roi_ratio = round(expected_monetary_value / cost_usd, 2)
        else:
            roi_ratio = 999.0 if expected_monetary_value > 0 else 0.0

        reasons: List[str] = []

        if not is_spend_permitted and cost_usd > 0:
            reasons.append(
                f"Application requires paid spend (${cost_usd:.2f} / ₹{cost_inr:.1f}), "
                f"which violates ALLOW_PAID_SPEND={self.allow_paid_spend} policy."
            )

        if gross_budget < 40.0 and gross_budget > 0:
            reasons.append(f"Budget (${gross_budget:.2f}) is below minimum viable threshold for senior engineering.")

        if fee_rate > 0:
            reasons.append(f"Platform fee: {int(fee_rate * 100)}% on {source.title()}.")

        if risk_discount < 0.8:
            reasons.append(f"High risk discounted expected revenue by {int((1.0 - risk_discount) * 100)}%.")

        # Recommendation determination
        recommendation: Literal["APPLY", "REVIEW", "SKIP"]
        if not is_spend_permitted and cost_usd > 0:
            recommendation = "REVIEW"
        elif expected_monetary_value <= 0.0 or fit_score < 40.0 or gross_budget < 40.0:
            recommendation = "SKIP"
            reasons.append(f"Expected Monetary Value is non-viable (${expected_monetary_value:.2f}).")
        elif expected_monetary_value >= 25.0 and fit_score >= 65.0 and is_spend_permitted:
            recommendation = "APPLY"
            reasons.append(
                f"Favorable economics: EV is +${expected_monetary_value:.2f} "
                f"with {p_win * 100:.1f}% estimated win rate."
            )
        else:
            recommendation = "REVIEW"
            reasons.append(f"Borderline economics (EV ${expected_monetary_value:.2f}). Manual review advised.")

        return EconomicsEvaluationSchema(
            application_cost_usd=cost_usd,
            application_cost_inr=cost_inr,
            estimated_gross_budget=gross_budget,
            platform_fee_rate=fee_rate,
            estimated_net_revenue=net_revenue,
            estimated_win_probability=p_win,
            expected_monetary_value=expected_monetary_value,
            risk_discount=risk_discount,
            is_spend_permitted=is_spend_permitted,
            roi_ratio=roi_ratio,
            recommendation=recommendation,
            reasons=reasons,
        )
