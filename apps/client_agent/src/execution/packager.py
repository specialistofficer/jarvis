"""
Manual Review 1-Click Submission Link Packager.
Assembles the complete application package (verified proposal, portfolio links,
recommended bid, and official application URL) for safe, compliant 1-click human submission.
"""
import json
from typing import List, Dict, Optional, Any

from src.models.entities import ApplicationModel, ProposalModel, OpportunityModel
from src.models.schemas import SubmissionPackageSchema
from src.profile.owner_data import PORTFOLIO_ITEMS


class ApplicationPackager:
    """Packages applications for seamless 1-click founder review and manual submission."""

    def build_package(
        self,
        application: ApplicationModel,
        proposal: Optional[ProposalModel] = None,
        opportunity: Optional[OpportunityModel] = None,
    ) -> SubmissionPackageSchema:
        opp = opportunity or application.opportunity
        if not opp:
            raise ValueError("Opportunity context required to package application")

        # Pick latest proposal if not explicitly passed
        prop = proposal
        if not prop and application.proposals:
            prop = application.proposals[-1]

        cover_letter = prop.cover_letter if prop else "No proposal drafted yet."
        strategy = prop.strategy if prop else "solution_first"

        # Resolve portfolio links from slug IDs
        portfolio_links: List[Dict[str, str]] = []
        if prop and prop.portfolio_item_ids_json:
            try:
                slugs = json.loads(prop.portfolio_item_ids_json)
                for slug in slugs:
                    for item in PORTFOLIO_ITEMS:
                        if item.slug == slug:
                            link = item.play_store_url or item.url or item.github_url or ""
                            portfolio_links.append({
                                "name": item.name,
                                "type": item.type,
                                "url": link,
                                "problem_solved": item.problem_solved,
                            })
            except Exception:
                pass

        # Generate source-tailored instructions
        src = opp.source.lower().strip()
        price_str = f"${application.proposed_price:,.0f} USD" if application.proposed_price else "standard rate"

        if "upwork" in src:
            instructions = (
                f"1. Click the official submission URL to open the Upwork job.\n"
                f"2. Paste the factually verified cover letter.\n"
                f"3. Set your proposed bid to {price_str}.\n"
                f"4. Cite your verified portfolio proof (e.g. ClothMatics on Play Store).\n"
                f"5. Submit manually to comply strictly with Upwork Terms of Service."
            )
        elif "reddit" in src:
            instructions = (
                f"1. Open the Reddit thread or PM the client.\n"
                f"2. Send the customized cover letter and verified portfolio links.\n"
                f"3. Quote proposed price: {price_str}."
            )
        elif "hackernews" in src:
            instructions = (
                f"1. Open the direct hiring contact URL/email.\n"
                f"2. Send your solution-first technical plan and portfolio links.\n"
                f"3. Quote {price_str}."
            )
        else:
            instructions = (
                f"1. Open the application link: {opp.url}.\n"
                f"2. Paste the verified proposal text.\n"
                f"3. Quote {price_str} and complete manual submission."
            )

        return SubmissionPackageSchema(
            application_id=application.id,
            opportunity_id=opp.id,
            source=opp.source,
            title=opp.title,
            submission_url=application.submission_url or opp.url,
            proposed_price=application.proposed_price,
            currency=opp.currency,
            cover_letter=cover_letter,
            strategy=strategy,
            portfolio_links=portfolio_links,
            instructions=instructions,
            mode=application.mode,
            status=application.status,
        )
