"""
Abstract AI Provider Interface.
"""
from abc import ABC, abstractmethod
from typing import Type, TypeVar, Optional, List, Dict, Any
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class AIProvider(ABC):
    """Abstract interface for LLM provider operations."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Provider identifier."""
        pass

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        temperature: float = 0.7,
        max_output_tokens: Optional[int] = None,
    ) -> str:
        """Generate freeform conversational or text response."""
        pass

    @abstractmethod
    async def structured_output(
        self,
        prompt: str,
        response_model: Type[T],
        system_instruction: Optional[str] = None,
        temperature: float = 0.2,
    ) -> T:
        """Generate structured output validated against a Pydantic model."""
        pass

    @abstractmethod
    async def classify(
        self,
        text: str,
        categories: List[str],
        system_instruction: Optional[str] = None,
    ) -> str:
        """Classify input text into one of the allowed categories."""
        pass

    @abstractmethod
    async def embed(self, text: str) -> List[float]:
        """Generate numerical embedding vector for the text."""
        pass
