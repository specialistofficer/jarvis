"""
Proposal Generation and Factual Verification Package.
"""
from src.proposals.validator import FactualVerificationGuard
from src.proposals.agent import ProposalGenerationAgent

__all__ = [
    "FactualVerificationGuard",
    "ProposalGenerationAgent",
]
