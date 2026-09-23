"""
Base Source Adapter Interface and Capability Matrix.
Every opportunity source must have an explicit capability contract.
"""
from abc import ABC, abstractmethod
from typing import List, Optional
from src.models.schemas import SourceCapabilitySchema, OpportunityCreateSchema


class BaseSourceAdapter(ABC):
    """Abstract base class for all freelance/contract opportunity sources."""

    def __init__(self, capability: SourceCapabilitySchema):
        self._capability = capability

    @property
    def capability(self) -> SourceCapabilitySchema:
        return self._capability

    @property
    def name(self) -> str:
        return self._capability.source

    @property
    def requires_human_approval(self) -> bool:
        return self._capability.requires_human_approval

    @property
    def is_application_supported(self) -> bool:
        return self._capability.application_supported

    @property
    def application_cost(self) -> float:
        return self._capability.application_cost

    @abstractmethod
    async def fetch_opportunities(
        self,
        query: Optional[str] = None,
        limit: int = 20,
    ) -> List[OpportunityCreateSchema]:
        """Fetch and normalize fresh opportunities from the source."""
        pass
