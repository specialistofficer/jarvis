"""
Hacker News Who Is Hiring Source Adapter using public official Algolia API.
"""
from typing import List, Optional
import re
import httpx
from src.sources.base import BaseSourceAdapter
from src.models.schemas import SourceCapabilitySchema, OpportunityCreateSchema

HACKERNEWS_CAPABILITY = SourceCapabilitySchema(
    source="hackernews",
    category="community",
    search_supported=True,
    read_supported=True,
    application_supported=False,
    direct_contact_supported=True,
    api_available=True,
    browser_automation_allowed=False,
    application_cost=0.0,
    daily_limit=30,
    monthly_limit=300,
    requires_human_approval=True,
)


class HackerNewsAdapter(BaseSourceAdapter):
    """Adapter fetching engineering contract / hiring listings from Hacker News."""

    def __init__(self, capability: Optional[SourceCapabilitySchema] = None):
        super().__init__(capability or HACKERNEWS_CAPABILITY)

    async def fetch_opportunities(
        self,
        query: Optional[str] = None,
        limit: int = 15,
    ) -> List[OpportunityCreateSchema]:
        opportunities: List[OpportunityCreateSchema] = []
        search_term = query or "freelance OR contract OR remote"
        url = f"https://hn.algolia.com/api/v1/search?query={search_term}&tags=comment&hitsPerPage=40"

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return []
                data = resp.json()
                hits = data.get("hits", [])
        except Exception:
            return []

        keywords = ["java", "spring", "react", "android", "full-stack", "backend", "api"]

        for hit in hits:
            comment_text = hit.get("comment_text") or ""
            # Strip simple HTML tags from HN comment
            clean_text = re.sub(r"<[^>]+>", " ", comment_text).strip()
            if len(clean_text) < 50:
                continue

            lower_text = clean_text.lower()
            if not any(k in lower_text for k in keywords):
                continue

            object_id = str(hit.get("objectID"))
            story_id = hit.get("story_id")
            hn_url = f"https://news.ycombinator.com/item?id={object_id}"

            # Derive concise title from first sentence
            first_sentence = clean_text.split(".")[0][:100]
            title = f"HN Freelance: {first_sentence}" if first_sentence else "HN Developer Project"

            opp = OpportunityCreateSchema(
                source=self.name,
                external_id=object_id,
                title=title,
                description=clean_text[:2000],
                url=hn_url,
                client_name=hit.get("author") or "HN Poster",
                client_country="Remote",
                currency="USD",
                required_skills=[k for k in keywords if k in lower_text],
                application_cost=0.0,
            )
            opportunities.append(opp)
            if len(opportunities) >= limit:
                break

        return opportunities
