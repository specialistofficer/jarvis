"""
Tests for AI Provider Abstraction and Mock/Gemini interfaces.
"""
import pytest
from pydantic import BaseModel
from src.ai.mock import MockAIProvider
from src.ai.provider import get_ai_provider
from src.models.schemas import OpportunityScoreResult, FactualVerificationReport


class SampleStructuredModel(BaseModel):
    summary: str
    confidence: float


@pytest.mark.asyncio
async def test_mock_ai_provider_generate():
    provider = MockAIProvider()
    response = await provider.generate("Help me write a proposal")
    assert "Mock generated response" in response
    assert len(provider.recorded_calls) == 1
    assert provider.recorded_calls[0]["type"] == "generate"


@pytest.mark.asyncio
async def test_mock_ai_provider_structured_output_score():
    provider = MockAIProvider()
    result = await provider.structured_output(
        prompt="Score this opportunity",
        response_model=OpportunityScoreResult,
    )
    assert isinstance(result, OpportunityScoreResult)
    assert result.recommended_action == "APPLY"
    assert result.fit_score >= 80.0
    assert result.technical_match >= 80.0


@pytest.mark.asyncio
async def test_mock_ai_provider_structured_output_verification():
    provider = MockAIProvider()
    result = await provider.structured_output(
        prompt="Verify proposal claims",
        response_model=FactualVerificationReport,
    )
    assert isinstance(result, FactualVerificationReport)
    assert result.is_valid is True
    assert len(result.unverified_claims) == 0


@pytest.mark.asyncio
async def test_mock_ai_provider_classify():
    provider = MockAIProvider()
    category = await provider.classify(
        text="Can we schedule a technical interview this Friday?",
        categories=["INTERESTED", "QUESTION", "INTERVIEW", "REJECTION"],
    )
    assert category in ["INTERESTED", "QUESTION", "INTERVIEW", "REJECTION"]


@pytest.mark.asyncio
async def test_mock_ai_provider_embed():
    provider = MockAIProvider()
    vector = await provider.embed("Java Spring developer")
    assert isinstance(vector, list)
    assert len(vector) > 0


def test_get_ai_provider_in_testing():
    # In testing mode without GEMINI_API_KEY, should return MockAIProvider
    provider = get_ai_provider()
    assert isinstance(provider, MockAIProvider)
