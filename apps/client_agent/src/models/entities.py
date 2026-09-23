"""
SQLAlchemy ORM Entities for Client Acquisition Agent.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    Boolean,
    Text,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import relationship
from src.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class OwnerProfileModel(Base):
    __tablename__ = "owner_profile"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    title = Column(String(150), nullable=False)
    years_of_experience = Column(Integer, nullable=False, default=10)
    bio = Column(Text, nullable=False)
    skills_json = Column(Text, nullable=False, default="[]")
    domains_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class PortfolioItemModel(Base):
    __tablename__ = "portfolio_items"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(150), nullable=False)
    slug = Column(String(100), unique=True, nullable=False)
    type = Column(String(50), nullable=False)  # mobile_app, web_app, enterprise_system, ai_utility
    url = Column(String(500), nullable=True)
    play_store_url = Column(String(500), nullable=True)
    github_url = Column(String(500), nullable=True)
    technologies_json = Column(Text, nullable=False, default="[]")
    features_json = Column(Text, nullable=False, default="[]")
    industry = Column(String(100), nullable=False)
    problem_solved = Column(Text, nullable=False)
    evidence_json = Column(Text, nullable=False, default="[]")
    description = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class SourceModel(Base):
    __tablename__ = "sources"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(50), unique=True, nullable=False)  # upwork, remoteok, reddit, etc.
    category = Column(String(50), nullable=False)  # marketplace, direct, community
    is_active = Column(Boolean, default=True, nullable=False)
    capabilities_json = Column(Text, nullable=False, default="{}")
    last_scanned_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class OpportunityModel(Base):
    __tablename__ = "opportunities"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    fingerprint = Column(String(64), unique=True, nullable=False, index=True)
    source = Column(String(50), nullable=False, index=True)
    external_id = Column(String(100), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    url = Column(String(500), nullable=False)
    client_name = Column(String(100), nullable=True)
    client_country = Column(String(100), nullable=True)
    client_spend = Column(Float, nullable=True)
    client_rating = Column(Float, nullable=True)
    budget_min = Column(Float, nullable=True)
    budget_max = Column(Float, nullable=True)
    currency = Column(String(10), default="USD", nullable=False)
    required_skills_json = Column(Text, default="[]", nullable=False)
    application_cost = Column(Float, default=0.0, nullable=False)
    status = Column(String(50), default="discovered", nullable=False, index=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    scores = relationship("OpportunityScoreModel", back_populates="opportunity", cascade="all, delete-orphan")
    applications = relationship("ApplicationModel", back_populates="opportunity", cascade="all, delete-orphan")


class OpportunityScoreModel(Base):
    __tablename__ = "opportunity_scores"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id = Column(String(36), ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False, index=True)
    fit_score = Column(Float, nullable=False)
    technical_match = Column(Float, nullable=False)
    portfolio_match = Column(Float, nullable=False)
    client_quality = Column(Float, nullable=False)
    value_score = Column(Float, nullable=False)
    competition_score = Column(Float, nullable=False)
    risk_score = Column(Float, nullable=False)
    recommended_action = Column(String(20), nullable=False)  # APPLY, REVIEW, SKIP
    reasoning_json = Column(Text, default="[]", nullable=False)
    recommended_portfolio_ids_json = Column(Text, default="[]", nullable=False)
    recommended_strategy = Column(Text, default="", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    opportunity = relationship("OpportunityModel", back_populates="scores")


class ApplicationModel(Base):
    __tablename__ = "applications"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    opportunity_id = Column(String(36), ForeignKey("opportunities.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(50), default="draft", nullable=False, index=True)  # draft, pending_approval, approved, submitted, won, lost
    mode = Column(String(30), default="APPROVAL_REQUIRED", nullable=False)
    proposed_price = Column(Float, nullable=True)
    submission_url = Column(String(500), nullable=True)
    submitted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utc_now)
    updated_at = Column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    opportunity = relationship("OpportunityModel", back_populates="applications")
    proposals = relationship("ProposalModel", back_populates="application", cascade="all, delete-orphan")
    messages = relationship("MessageModel", back_populates="application", cascade="all, delete-orphan")


class ProposalModel(Base):
    __tablename__ = "proposals"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    application_id = Column(String(36), ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True)
    version = Column(Integer, default=1, nullable=False)
    cover_letter = Column(Text, nullable=False)
    strategy = Column(String(100), default="solution_first", nullable=False)
    portfolio_item_ids_json = Column(Text, default="[]", nullable=False)
    is_factually_verified = Column(Boolean, default=False, nullable=False)
    verification_report_json = Column(Text, default="{}", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)

    application = relationship("ApplicationModel", back_populates="proposals")


class MessageModel(Base):
    __tablename__ = "messages"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    application_id = Column(String(36), ForeignKey("applications.id", ondelete="CASCADE"), nullable=False, index=True)
    sender = Column(String(50), nullable=False)  # client, founder, assistant
    text = Column(Text, nullable=False)
    intent = Column(String(50), nullable=True)  # INTERESTED, QUESTION, INTERVIEW, NEGOTIATION, REJECTION, SPAM, UNCLEAR
    suggested_reply = Column(Text, nullable=True)
    status = Column(String(30), default="received", nullable=False)  # received, replied, ignored
    created_at = Column(DateTime(timezone=True), default=utc_now)

    application = relationship("ApplicationModel", back_populates="messages")


class AuditLogModel(Base):
    __tablename__ = "audit_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_type = Column(String(50), nullable=False, index=True)  # discovery, score, proposal_generate, verify, approve, apply
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(String(36), nullable=False)
    details_json = Column(Text, default="{}", nullable=False)
    created_at = Column(DateTime(timezone=True), default=utc_now)

