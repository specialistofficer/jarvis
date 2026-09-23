"""
Opportunity Fingerprinting and Deduplication Utilities.
Generates deterministic SHA-256 hashes to prevent redundant processing.
"""
import re
import hashlib
from typing import Optional
from datetime import datetime, timezone, timedelta
from src.models.schemas import OpportunityCreateSchema


def normalize_string(val: Optional[str]) -> str:
    """Normalize text by converting to lowercase and stripping punctuation/whitespace."""
    if not val:
        return ""
    text = val.lower().strip()
    # Replace multiple whitespace and non-alphanumeric chars with single space
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def generate_opportunity_fingerprint(
    source: str,
    title: str,
    external_id: Optional[str] = None,
    client_name: Optional[str] = None,
    budget_max: Optional[float] = None,
    budget_min: Optional[float] = None,
) -> str:
    """
    Generate a deterministic 64-character SHA-256 fingerprint.
    If external_id exists, it anchors the identity.
    Otherwise, normalized title, client, and budget anchor identity.
    """
    src_norm = normalize_string(source)
    ext_norm = normalize_string(external_id)
    title_norm = normalize_string(title)
    client_norm = normalize_string(client_name)
    budget_val = round(budget_max or budget_min or 0.0, 2)

    if ext_norm:
        canonical_str = f"{src_norm}:{ext_norm}"
    else:
        canonical_str = f"{src_norm}:{title_norm}:{client_norm}:{budget_val}"

    return hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()


def generate_from_opportunity(opp: OpportunityCreateSchema) -> str:
    """Helper to generate fingerprint directly from an OpportunityCreateSchema."""
    return generate_opportunity_fingerprint(
        source=opp.source,
        title=opp.title,
        external_id=opp.external_id,
        client_name=opp.client_name,
        budget_max=opp.budget_max,
        budget_min=opp.budget_min,
    )


def is_opportunity_stale(
    posted_at: Optional[datetime],
    max_age_days: int = 14,
) -> bool:
    """Check if an opportunity is older than the allowed freshness window."""
    if not posted_at:
        return False
    now = datetime.now(timezone.utc)
    if posted_at.tzinfo is None:
        posted_at = posted_at.replace(tzinfo=timezone.utc)
    return (now - posted_at) > timedelta(days=max_age_days)
