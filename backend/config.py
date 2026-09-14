from __future__ import annotations

import os
from pathlib import Path
from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import Field, model_validator


PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_ENV_FILE = Path(__file__).resolve().parent / ".env"


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Orbit CRM Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = Field(default=True, validation_alias="DEBUG")
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Supabase (optional at import time so the app boots even if not yet configured)
    SUPABASE_URL: str = Field(default="", validation_alias="SUPABASE_URL")
    SUPABASE_SERVICE_ROLE_KEY: str = Field(default="", validation_alias="SUPABASE_SERVICE_ROLE_KEY")
    SUPABASE_PUBLISHABLE_KEY: str = Field(default="", validation_alias="SUPABASE_PUBLISHABLE_KEY")
    EXPECTED_SUPABASE_PROJECT_REF: str = Field(
        default="", validation_alias="EXPECTED_SUPABASE_PROJECT_REF"
    )
    SUPABASE_STORAGE_BUCKET: str = "orbit-projects"

    # AI provider API keys (all optional — app must not crash if any are missing)
    NVIDIA_API_KEY: Optional[str] = Field(default=None, validation_alias="NVIDIA_API_KEY")
    NVIDIA_MODEL: str = Field(default="", validation_alias="NVIDIA_MODEL")
    NVIDIA_BASE_URL: str = Field(
        default="https://integrate.api.nvidia.com/v1",
        validation_alias="NVIDIA_BASE_URL",
    )
    OPENAI_API_KEY: Optional[str] = Field(default=None, validation_alias="OPENAI_API_KEY")
    OPENAI_MODEL: str = Field(default="", validation_alias="OPENAI_MODEL")
    OPENAI_BASE_URL: str = Field(
        default="https://api.openai.com/v1",
        validation_alias="OPENAI_BASE_URL",
    )
    AI_MODEL_CONFIGS_JSON: str = Field(default="", validation_alias="AI_MODEL_CONFIGS_JSON")
    AI_WORKFLOW_AUTORUN: bool = Field(default=True, validation_alias="AI_WORKFLOW_AUTORUN")
    AI_WORKFLOW_WORKER_ENABLED: bool = Field(
        default=True,
        validation_alias="AI_WORKFLOW_WORKER_ENABLED",
    )
    AI_WORKFLOW_WORKER_CONCURRENCY: int = Field(
        default=4,
        validation_alias="AI_WORKFLOW_WORKER_CONCURRENCY",
    )
    AI_WORKFLOW_POLL_INTERVAL_SECONDS: float = Field(
        default=1.5,
        validation_alias="AI_WORKFLOW_POLL_INTERVAL_SECONDS",
    )
    AI_WORKFLOW_SWEEP_INTERVAL_SECONDS: float = Field(
        default=60.0,
        validation_alias="AI_WORKFLOW_SWEEP_INTERVAL_SECONDS",
    )
    AI_WORKFLOW_MAX_QA_REVISIONS: int = Field(
        default=2,
        validation_alias="AI_WORKFLOW_MAX_QA_REVISIONS",
    )
    AI_WORKFLOW_TEST_FAIL_MODEL: str = Field(
        default="",
        validation_alias="AI_WORKFLOW_TEST_FAIL_MODEL",
    )
    GEMINI_API_KEY: Optional[str] = Field(default=None, validation_alias="GEMINI_API_KEY")
    GROQ_API_KEY: Optional[str] = Field(default=None, validation_alias="GROQ_API_KEY")
    GROQ_MODEL: str = Field(default="", validation_alias="GROQ_MODEL")
    GROQ_BASE_URL: str = Field(
        default="https://api.groq.com/openai/v1",
        validation_alias="GROQ_BASE_URL",
    )

    # OpenAI-compatible remote model endpoint.
    # Kept under the existing OLLAMA_* names for compatibility with older env files.
    OLLAMA_BASE_URL: str = Field(
        default="https://integrate.api.nvidia.com/v1",
        validation_alias="OLLAMA_BASE_URL",
    )
    OLLAMA_MODEL: str = Field(default="openai/gpt-oss-120b", validation_alias="OLLAMA_MODEL")
    OLLAMA_API_KEY: str = Field(default="", validation_alias="OLLAMA_API_KEY")

    # Faster-Whisper
    WHISPER_MODEL: str = Field(default="tiny", validation_alias="WHISPER_MODEL")
    WHISPER_DEVICE: str = Field(default="cpu", validation_alias="WHISPER_DEVICE")
    WHISPER_COMPUTE_TYPE: str = Field(default="int8", validation_alias="WHISPER_COMPUTE_TYPE")
    WHISPER_LANGUAGE: str = Field(default="ru", validation_alias="WHISPER_LANGUAGE")

    # Telegram Bot
    TELEGRAM_BOT_TOKEN: str = Field(default="", validation_alias="TELEGRAM_BOT_TOKEN")
    TELEGRAM_CHAT_ID: str = Field(default="", validation_alias="TELEGRAM_CHAT_ID")
    TELEGRAM_WEBHOOK_URL: str = Field(default="", validation_alias="TELEGRAM_WEBHOOK_URL")

    # OpenManus / Playwright
    OPENMANUS_HEADLESS: bool = Field(default=True, validation_alias="OPENMANUS_HEADLESS")
    OPENMANUS_SLOW_MO: int = Field(default=100, validation_alias="OPENMANUS_SLOW_MO")
    OPENMANUS_TIMEOUT: int = Field(default=300, validation_alias="OPENMANUS_TIMEOUT")

    # Lead Generator (existing)
    LEAD_GEN_HOST: str = "0.0.0.0"
    LEAD_GEN_PORT: int = 8090
    REPORTS_DIR: str = "./reports"

    # Notion (existing)
    NOTION_API_KEY: str = Field(default="", validation_alias="NOTION_API_KEY")
    NOTION_DATABASE_ID: str = Field(default="", validation_alias="NOTION_DATABASE_ID")

    # OpenClaw Gateway
    OPENCLAW_URL: str = Field(default="http://127.0.0.1:18789", validation_alias="OPENCLAW_URL")
    OPENCLAW_GATEWAY_TOKEN: str = Field(default="", validation_alias="OPENCLAW_GATEWAY_TOKEN")
    OPENCLAW_WEBHOOK_TOKEN: str = Field(default="", validation_alias="OPENCLAW_WEBHOOK_TOKEN")
    OPENCLAW_REQUEST_TIMEOUT: float = Field(default=120.0, validation_alias="OPENCLAW_REQUEST_TIMEOUT")
    OPENCLAW_DAILY_ACTION_LIMIT: int = Field(default=100, validation_alias="OPENCLAW_DAILY_ACTION_LIMIT")
    OPENCLAW_MAX_CONTEXT_RECORDS: int = Field(default=20, validation_alias="OPENCLAW_MAX_CONTEXT_RECORDS")

    # CORS — allow Vercel deployments, ngrok, cloudflare tunnels, and local dev
    CORS_ORIGINS: list[str] = Field(
        default=[
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5174",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
            "https://aura-crm.vercel.app",
        ],
        validation_alias="CORS_ORIGINS",
    )

    # Regex for CORS origin matching — allows all *.vercel.app subdomains.
    CORS_ORIGIN_REGEX: str = Field(
        default=r"https://.*\.vercel\.app$",
        validation_alias="CORS_ORIGIN_REGEX",
    )

    # Server-to-server auth: Vercel proxy must send this as `Authorization: Bearer <token>`
    INTERNAL_API_TOKEN: str = Field(default="", validation_alias="INTERNAL_API_TOKEN")

    # Local self-hosted development provider. This token is intentionally
    # separate from INTERNAL_API_TOKEN and OpenClaw credentials.
    SELFDEV_PROVIDER_TOKEN: str = Field(default="", validation_alias="SELFDEV_PROVIDER_TOKEN")
    SELFDEV_PROVIDER_LEASE_SECONDS: int = Field(
        default=90,
        validation_alias="SELFDEV_PROVIDER_LEASE_SECONDS",
    )

    # Stripe
    STRIPE_SECRET_KEY: str = Field(default="", validation_alias="STRIPE_SECRET_KEY")
    STRIPE_PUBLISHABLE_KEY: str = Field(default="", validation_alias="STRIPE_PUBLISHABLE_KEY")
    STRIPE_WEBHOOK_SECRET: str = Field(default="", validation_alias="STRIPE_WEBHOOK_SECRET")

    # Self-development autopilot: coding_executor git/PR automation.
    # Fine-grained PAT scoped to Contents + Pull requests (+ Administration only
    # once project-scoped repo auto-creation ships). Never logged, never sent to the frontend.
    GITHUB_TOKEN: str = Field(default="", validation_alias="GITHUB_TOKEN")
    GITHUB_REPO: str = Field(default="", validation_alias="GITHUB_REPO")
    # Optional: create per-project repositories under this GitHub organization
    # instead of the token owner's personal account. Requires Administration
    # (read & write) on GITHUB_TOKEN.
    GITHUB_PROJECTS_ORG: str = Field(default="", validation_alias="GITHUB_PROJECTS_ORG")
    # Overrides the coding executor's model. Must support function calling —
    # the app-wide chat default does not, so leave empty to use the verified
    # per-provider choice in coding_executor.TOOL_CAPABLE_MODELS.
    CODING_EXECUTOR_MODEL: str = Field(default="", validation_alias="CODING_EXECUTOR_MODEL")

    @model_validator(mode="after")
    def validate_supabase_project(self) -> "Settings":
        expected = self.EXPECTED_SUPABASE_PROJECT_REF.strip()
        if expected and self.SUPABASE_URL:
            hostname = self.SUPABASE_URL.split("//", 1)[-1].split("/", 1)[0]
            actual = hostname.split(".", 1)[0]
            if actual != expected:
                raise ValueError(
                    "SUPABASE_URL project ref does not match EXPECTED_SUPABASE_PROJECT_REF"
                )
        return self

    class Config:
        env_file = (PROJECT_ROOT / ".env", BACKEND_ENV_FILE)
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
