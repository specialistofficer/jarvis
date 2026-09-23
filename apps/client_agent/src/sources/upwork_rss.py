"""
Upwork RSS Public Feed Adapter.
Extracts public contract/freelance listings safely and complies with Upwork terms.
Direct headless browser submissions are STRICTLY PROHIBITED; provides manual 1-click apply URL.
"""
from typing import List, Optional
import xml.etree.ElementTree as ET
import re
import httpx
from src.sources.base import BaseSourceAdapter
from src.models.schemas import SourceCapabilitySchema, OpportunityCreateSchema

UPWORK_CAPABILITY = SourceCapabilitySchema(
    source="upwork",
    category="marketplace",
    search_supported=True,
    read_supported=True,
    application_supported=False,  # Terms prohibit automated headless submission
    direct_contact_supported=False,
    api_available=True,
    browser_automation_allowed=False,
    application_cost=16.0,  # Average proposal connects cost in INR equivalent
    daily_limit=25,
    monthly_limit=250,
    requires_human_approval=True,
)


class UpworkRssAdapter(BaseSourceAdapter):
    """Adapter fetching Upwork opportunities via public search RSS feeds."""

    def __init__(self, capability: Optional[SourceCapabilitySchema] = None):
        super().__init__(capability or UPWORK_CAPABILITY)

    async def fetch_opportunities(
        self,
        query: Optional[str] = None,
        limit: int = 15,
    ) -> List[OpportunityCreateSchema]:
        opportunities: List[OpportunityCreateSchema] = []
        search_query = query or "java OR spring OR react OR android"
        encoded_query = search_query.replace(" ", "+")
        rss_url = f"https://www.upwork.com/ab/feed/jobs/rss?q={encoded_query}&sort=recency"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/rss+xml, application/xml, text/xml",
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(rss_url, headers=headers)
                if resp.status_code != 200 or not resp.text:
                    return []
                xml_content = resp.text
                root = ET.fromstring(xml_content)
        except Exception:
            return []

        # Find items under channel
        channel = root.find("channel")
        if channel is None:
            return []

        items = channel.findall("item")

        for item in items[:limit]:
            title_elem = item.find("title")
            link_elem = item.find("link")
            desc_elem = item.find("description")

            title = title_elem.text if title_elem is not None and title_elem.text else "Upwork Opportunity"
            link = link_elem.text if link_elem is not None and link_elem.text else "https://www.upwork.com"
            raw_desc = desc_elem.text if desc_elem is not None and desc_elem.text else ""

            # Extract external job ID from link
            match = re.search(r"~([a-f0-9]+)", link)
            external_id = match.group(1) if match else link

            # Parse Budget or Hourly Range if in description
            budget = None
            budget_match = re.search(r"Budget</b>:\s*\$([0-9,]+)", raw_desc)
            if budget_match:
                try:
                    budget = float(budget_match.group(1).replace(",", ""))
                except ValueError:
                    budget = None

            # Clean HTML from description
            clean_desc = re.sub(r"<[^>]+>", " ", raw_desc).strip()

            opp = OpportunityCreateSchema(
                source=self.name,
                external_id=external_id,
                title=title,
                description=clean_desc[:2500],
                url=link,
                client_name="Upwork Client",
                client_country="Global",
                budget_max=budget,
                currency="USD",
                required_skills=[query] if query else ["Software Engineering"],
                application_cost=self.application_cost,
            )
            opportunities.append(opp)

        return opportunities
