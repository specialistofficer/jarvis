"""
Configuration and environment settings for the Personal AI Client Acquisition Agent.
"""
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Environment
    ENVIRONMENT: Literal["development", "production", "testing"] = "development"
    DATABASE_URL: str = "sqlite+aiosqlite:///./client_agent.db"

    # Founder Authentication & Gate
    FOUNDER_EMAIL: str = "founder@example.com"
    API_SECRET_TOKEN: str = "dev-secret-token-change-in-prod"

    # AI Providers
    GEMINI_API_KEY: str | None = None
    GEMINI_MODEL: str = "gemini-2.5-flash"
    NVIDIA_API_KEY: str | None = None
    NVIDIA_MODEL: str = "meta/llama-3.1-8b-instruct"

    # Telegram Notification & Interactive Bot
    TELEGRAM_BOT_TOKEN: str | None = None
    TELEGRAM_CHAT_ID: str | None = None

    # Safety & Spend Control
    ALLOW_PAID_SPEND: bool = False
    MAX_COST_INR: float = 0.0
    USD_TO_INR_RATE: float = 85.0
    DEFAULT_APPLICATION_MODE: Literal["MANUAL", "APPROVAL_REQUIRED", "AUTO"] = "APPROVAL_REQUIRED"
    DAILY_APPLICATION_LIMIT: int = 10
    AUTO_APPLY_ENABLED: bool = False


settings = Settings()
