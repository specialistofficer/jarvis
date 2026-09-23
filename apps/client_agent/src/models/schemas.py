"""
Pydantic v2 schemas and DTOs for the Client Acquisition Agent.
"""
from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field


class OwnerProfileSchema(BaseModel):
    name: str = "Chirag"
    title: str = "Senior Full-Stack & Enterprise Software Engineer"
    years_of_experience: int = 10
    bio: str
    skills: List[str]
    domains: List[str]


class PortfolioItemSchema(BaseModel):
    name: str
    slug: str
    type: Literal["mobile_app", "web_app", "enterprise_system", "ai_utility"]
    url: Optional[str] = None
    play_store_url: Optional[str] = None
    github_url: Optional[str] = None
    technologies: List[str]
    features: List[str]
    industry: str
    problem_solved: str
    evidence: List[str] = Field(default_factory=list)
    description: str


class SourceCapabilitySchema(BaseModel):
    source: str
    category: Literal["marketplace", "direct", "social", "community"]
    search_supported: bool = True
    read_supported: bool = True
    application_supported: bool = False
    direct_contact_supported: bool = False
    api_available: bool = False
    browser_automation_allowed: bool = False
    application_cost: float = 0.0
    daily_limit: int = 10
    monthly_limit: int = 100
    requires_human_approval: bool = True


class OpportunityCreateSchema(BaseModel):
    source: str
    external_id: Optional[str] = None
    title: str
    description: str
    url: str
    client_name: Optional[str] = None
    client_country: Optional[str] = None
    client_spend: Optional[float] = None
    client_rating: Optional[float] = None
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    currency: str = "USD"
    required_skills: List[str] = Field(default_factory=list)
    application_cost: float = 0.0


class EconomicsEvaluationSchema(BaseModel):
    application_cost_usd: float = Field(ge=0)
    application_cost_inr: float = Field(ge=0)
    estimated_gross_budget: float = Field(ge=0)
    platform_fee_rate: float = Field(ge=0, le=1.0)
    estimated_net_revenue: float = Field(ge=0)
    estimated_win_probability: float = Field(ge=0, le=1.0)
    expected_monetary_value: float
    risk_discount: float = Field(ge=0, le=1.0)
    is_spend_permitted: bool
    roi_ratio: float
    recommendation: Literal["APPLY", "REVIEW", "SKIP"]
    reasons: List[str] = Field(default_factory=list)


class OpportunityScoreResult(BaseModel):
    fit_score: float = Field(ge=0, le=100)
    technical_match: float = Field(ge=0, le=100)
    portfolio_match: float = Field(ge=0, le=100)
    client_quality: float = Field(ge=0, le=100)
    value_score: float = Field(ge=0, le=100)
    competition_score: float = Field(ge=0, le=100)
    risk_score: float = Field(ge=0, le=100)
    application_cost: float = Field(ge=0)
    recommended_action: Literal["APPLY", "REVIEW", "SKIP"]
    reasoning: List[str]
    recommended_portfolio_slugs: List[str]
    recommended_strategy: str
    economics: Optional[EconomicsEvaluationSchema] = None


class ProposalDraftSchema(BaseModel):
    cover_letter: str
    strategy: str
    selected_portfolio_slugs: List[str]
    proposed_price: Optional[float] = None


class FactualVerificationReport(BaseModel):
    is_valid: bool
    unverified_claims: List[str] = Field(default_factory=list)
    unlisted_technologies: List[str] = Field(default_factory=list)
    suspicious_metrics: List[str] = Field(default_factory=list)
    verdict_notes: str


class SubmissionPackageSchema(BaseModel):
    application_id: str
    opportunity_id: str
    source: str
    title: str
    submission_url: str
    proposed_price: Optional[float] = None
    currency: str = "USD"
    cover_letter: str
    strategy: str
    portfolio_links: List[Dict[str, str]] = Field(default_factory=list)
    instructions: str
    mode: Literal["MANUAL", "APPROVAL_REQUIRED", "AUTO"]
    status: str

