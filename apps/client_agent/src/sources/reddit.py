"""
Reddit ForHire Source Adapter using public JSON search endpoints.
"""
from typing import List, Optional
import httpx
from src.sources.base import BaseSourceAdapter
from src.models.schemas import SourceCapabilitySchema, OpportunityCreateSchema

REDDIT_CAPABILITY = SourceCapabilitySchema(
    source="reddit_forhire",
    category="community",
    search_supported=True,
    read_supported=True,
    application_supported=False,
    direct_contact_supported=True,
    api_available=True,
    browser_automation_allowed=False,
    application_cost=0.0,
    daily_limit=20,
    monthly_limit=200,
    requires_human_approval=True,
)


class RedditForHireAdapter(BaseSourceAdapter):
    """Adapter fetching hiring posts from Reddit community (r/forhire)."""

    def __init__(self, capability: Optional[SourceCapabilitySchema] = None):
        super().__init__(capability or REDDIT_CAPABILITY)

    async def fetch_opportunities(
        self,
        query: Optional[str] = None,
        limit: int = 15,
    ) -> List[OpportunityCreateSchema]:
        opportunities: List[OpportunityCreateSchema] = []
        search_query = query or "developer OR programmer OR app"
        url = f"https://www.reddit.com/r/forhire/search.json?q=flair%3Ahiring+{search_query}&restrict_sr=1&sort=new&limit={limit}"

        headers = {
            "User-Agent": "JarvisFreelanceBot/1.0 (by /u/specialistofficer)",
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(url, headers=headers)
                if resp.status_code != 200:
                    return []
                data = resp.json()
        except Exception:
            return []

        children = data.get("data", {}).get("children", [])

        for child in children:
            post = child.get("data", {})
            title = post.get("title", "")
            selftext = post.get("selftext", "")
            permalink = post.get("permalink", "")
            author = post.get("author", "Reddit User")
            post_id = post.get("id", "")

            if not title or "[hiring]" not in title.lower():
                continue

            full_url = f"https://www.reddit.com{permalink}" if permalink else f"https://reddit.com/r/forhire/comments/{post_id}"

            opp = OpportunityCreateSchema(
                source=self.name,
                external_id=post_id,
                title=title,
                description=selftext[:2000] if selftext else title,
                url=full_url,
                client_name=author,
                client_country="Remote/Global",
                currency="USD",
                required_skills=[query] if query else ["Software Development"],
                application_cost=0.0,
            )
            opportunities.append(opp)

        return opportunities
