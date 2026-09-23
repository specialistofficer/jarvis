"""
AI Provider Factory.
"""
from src.ai.base import AIProvider
from src.ai.gemini import GeminiProvider
from src.ai.mock import MockAIProvider
from src.config import settings


def get_ai_provider() -> AIProvider:
    """Factory to retrieve configured AI Provider."""
    if settings.ENVIRONMENT == "testing" or not settings.GEMINI_API_KEY:
        return MockAIProvider()
    return GeminiProvider()
