"""
Discovery Agent Orchestrator.
Coordinates multi-source scanning, normalization, fingerprinting, and deduplication.
"""
import json
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.entities import OpportunityModel
from src.models.schemas import OpportunityCreateSchema
from src.sources.base import BaseSourceAdapter
from src.sources.fingerprint import generate_from_opportunity
from src.sources.remoteok import RemoteOKAdapter
from src.sources.hackernews import HackerNewsAdapter
from src.sources.upwork_rss import UpworkRssAdapter
from src.sources.reddit import RedditForHireAdapter
from src.audit.logger import record_audit_event


class DiscoveryRunResult(BaseModel):
    sources_scanned: List[str]
    total_found: int
    inserted: int
    duplicates: int
    sample_titles: List[str]


class DiscoveryAgent:
    """Orchestrates continuous opportunity discovery across multiple vetted sources."""

    def __init__(self, adapters: Optional[List[BaseSourceAdapter]] = None):
        self._adapters: Dict[str, BaseSourceAdapter] = {}
        defaults = adapters or [
            RemoteOKAdapter(),
            HackerNewsAdapter(),
            UpworkRssAdapter(),
            RedditForHireAdapter(),
        ]
        for adapter in defaults:
            self.register_adapter(adapter)

    def register_adapter(self, adapter: BaseSourceAdapter) -> None:
        self._adapters[adapter.name] = adapter

    async def run_discovery(
        self,
        session: AsyncSession,
        query: Optional[str] = None,
        source_names: Optional[List[str]] = None,
        per_source_limit: int = 15,
    ) -> DiscoveryRunResult:
        active_adapters = [
            adapter for name, adapter in self._adapters.items()
            if source_names is None or name in source_names
        ]

        total_found = 0
        inserted_count = 0
        duplicate_count = 0
        sample_titles: List[str] = []
        sources_scanned: List[str] = []

        for adapter in active_adapters:
            sources_scanned.append(adapter.name)
            try:
                opps = await adapter.fetch_opportunities(query=query, limit=per_source_limit)
                total_found += len(opps)

                for opp in opps:
                    fingerprint = generate_from_opportunity(opp)

                    # Check for duplicate fingerprint in database
                    existing = await session.execute(
                        select(OpportunityModel.id).where(OpportunityModel.fingerprint == fingerprint).limit(1)
                    )
                    if existing.scalars().first() is not None:
                        duplicate_count += 1
                        continue

                    # Insert fresh opportunity
                    new_opp = OpportunityModel(
                        fingerprint=fingerprint,
                        source=opp.source,
                        external_id=opp.external_id,
                        title=opp.title,
                        description=opp.description,
                        url=opp.url,
                        client_name=opp.client_name,
                        client_country=opp.client_country,
                        client_spend=opp.client_spend,
                        client_rating=opp.client_rating,
                        budget_min=opp.budget_min,
                        budget_max=opp.budget_max,
                        currency=opp.currency,
                        required_skills_json=json.dumps(opp.required_skills),
                        application_cost=opp.application_cost,
                        status="discovered",
                    )
                    session.add(new_opp)
                    await session.flush()  # assign ID

                    # Audit record
                    await record_audit_event(
                        session=session,
                        event_type="opportunity_discovered",
                        entity_type="opportunity",
                        entity_id=new_opp.id,
                        details={
                            "source": opp.source,
                            "title": opp.title,
                            "url": opp.url,
                            "fingerprint": fingerprint,
                            "cost": opp.application_cost,
                        },
                    )

                    inserted_count += 1
                    if len(sample_titles) < 5:
                        sample_titles.append(f"[{opp.source}] {opp.title}")

            except Exception as e:
                # Resilient error handling per source to prevent one failure from crashing entire scan
                print(f"Error scanning source {adapter.name}: {e}")
                continue

        await session.commit()

        return DiscoveryRunResult(
            sources_scanned=sources_scanned,
            total_found=total_found,
            inserted=inserted_count,
            duplicates=duplicate_count,
            sample_titles=sample_titles,
        )
