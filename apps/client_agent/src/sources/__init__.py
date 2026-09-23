"""
Sources and Adapters Package.
"""
from src.sources.base import BaseSourceAdapter
from src.sources.fingerprint import (
    generate_opportunity_fingerprint,
    generate_from_opportunity,
    is_opportunity_stale,
)
from src.sources.remoteok import RemoteOKAdapter
from src.sources.hackernews import HackerNewsAdapter
from src.sources.upwork_rss import UpworkRssAdapter
from src.sources.reddit import RedditForHireAdapter

__all__ = [
    "BaseSourceAdapter",
    "generate_opportunity_fingerprint",
    "generate_from_opportunity",
    "is_opportunity_stale",
    "RemoteOKAdapter",
    "HackerNewsAdapter",
    "UpworkRssAdapter",
    "RedditForHireAdapter",
]
