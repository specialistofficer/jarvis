"""
RemoteOK Public Source Adapter.
Compliant with RemoteOK public JSON API.
"""
from typing import List, Optional
import httpx
from src.sources.base import BaseSourceAdapter
from src.models.schemas import SourceCapabilitySchema, OpportunityCreateSchema

REMOTEOK_CAPABILITY = SourceCapabilitySchema(
    source="remoteok",
    category="direct",
    search_supported=True,
    read_supported=True,
    application_supported=False,  # External link redirect
    direct_contact_supported=False,
    api_available=True,
    browser_automation_allowed=False,
    application_cost=0.0,
    daily_limit=50,
    monthly_limit=500,
    requires_human_approval=True,
)


class RemoteOKAdapter(BaseSourceAdapter):
    """Adapter fetching remote software engineering opportunities from RemoteOK API."""

    def __init__(self, capability: Optional[SourceCapabilitySchema] = None):
        super().__init__(capability or REMOTEOK_CAPABILITY)

    async def fetch_opportunities(
        self,
        query: Optional[str] = None,
        limit: int = 20,
    ) -> List[OpportunityCreateSchema]:
        opportunities: List[OpportunityCreateSchema] = []
        url = "https://remoteok.com/api"

        headers = {
            "User-Agent": "JarvisPersonalAgent/1.0 (Developer Opportunity Search; contact: founder@example.com)",
            "Accept": "application/json",
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=headers)
                if resp.status_code != 200:
                    return []
                items = resp.json()
        except Exception:
            return []

        # First element of RemoteOK response is metadata/disclaimer object
        job_items = [i for i in items if isinstance(i, dict) and "id" in i]

        keywords = [query.lower()] if query else ["java", "spring", "react", "android", "fullstack", "api", "ai"]

        for item in job_items[:limit * 3]:
            title = item.get("position", "")
            description = item.get("description", "")
            tags = item.get("tags", [])
            company = item.get("company", "Direct Client")
            item_url = item.get("url") or f"https://remoteok.com/remote-jobs/{item.get('id')}"

            # Filter relevant to developer skills
            text_corpus = f"{title} {description} {' '.join(tags)}".lower()
            if not any(k in text_corpus for k in keywords):
                continue

            # Parse salary/budget if present
            salary_min = float(item["salary_min"]) if item.get("salary_min") else None
            salary_max = float(item["salary_max"]) if item.get("salary_max") else None

            opp = OpportunityCreateSchema(
                source=self.name,
                external_id=str(item.get("id")),
                title=title,
                description=description[:2500],  # Bound description size
                url=item_url,
                client_name=company,
                client_country=item.get("location") or "Remote",
                budget_min=salary_min,
                budget_max=salary_max,
                currency="USD",
                required_skills=tags,
                application_cost=0.0,
            )
            opportunities.append(opp)
            if len(opportunities) >= limit:
                break

        return opportunities
