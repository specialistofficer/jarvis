"""
Mock AI Provider for unit tests, offline development, and zero-spend testing.
"""
from typing import Type, TypeVar, Optional, List, Dict, Any
from pydantic import BaseModel
from src.ai.base import AIProvider

T = TypeVar("T", bound=BaseModel)


class MockAIProvider(AIProvider):
    """Deterministic Mock AI Provider for testing."""

    def __init__(self, name: str = "MockAI"):
        self._name = name
        self.recorded_calls: List[Dict[str, Any]] = []

    @property
    def name(self) -> str:
        return self._name

    async def generate(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        temperature: float = 0.7,
        max_output_tokens: Optional[int] = None,
    ) -> str:
        self.recorded_calls.append({"type": "generate", "prompt": prompt})
        return f"[Mock generated response to: {prompt[:40]}...]"

    async def structured_output(
        self,
        prompt: str,
        response_model: Type[T],
        system_instruction: Optional[str] = None,
        temperature: float = 0.2,
    ) -> T:
        self.recorded_calls.append({"type": "structured_output", "model": response_model.__name__})
        # If response_model has default values or mock fields, construct mock instance
        # Provide sensible mock defaults for our specific schemas
        from src.models.schemas import OpportunityScoreResult, FactualVerificationReport

        if response_model is OpportunityScoreResult:
            return OpportunityScoreResult(
                fit_score=88.0,
                technical_match=90.0,
                portfolio_match=85.0,
                client_quality=80.0,
                value_score=85.0,
                competition_score=50.0,
                risk_score=15.0,
                application_cost=0.0,
                recommended_action="APPLY",
                reasoning=["Strong match with verified skills", "Relevant portfolio evidence available"],
                recommended_portfolio_slugs=["clothmatics-ai"],
                recommended_strategy="solution_first",
            )
        elif response_model is FactualVerificationReport:
            return FactualVerificationReport(
                is_valid=True,
                unverified_claims=[],
                unlisted_technologies=[],
                suspicious_metrics=[],
                verdict_notes="All claims match verified profile.",
            )

        # Generic Pydantic fallback construct
        return response_model.model_validate({})

    async def classify(
        self,
        text: str,
        categories: List[str],
        system_instruction: Optional[str] = None,
    ) -> str:
        self.recorded_calls.append({"type": "classify", "text": text})
        return categories[0] if categories else "UNKNOWN"

    async def embed(self, text: str) -> List[float]:
        self.recorded_calls.append({"type": "embed", "text": text})
        return [0.1] * 768
