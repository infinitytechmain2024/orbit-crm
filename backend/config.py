import os
from pathlib import Path
from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Orbit CRM Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = Field(default=True, validation_alias="DEBUG")
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Supabase
    SUPABASE_URL: str = Field(validation_alias="SUPABASE_URL")
    SUPABASE_SERVICE_ROLE_KEY: str = Field(validation_alias="SUPABASE_SERVICE_ROLE_KEY")
    SUPABASE_PUBLISHABLE_KEY: str = Field(validation_alias="SUPABASE_PUBLISHABLE_KEY")
    SUPABASE_STORAGE_BUCKET: str = "orbit-projects"

    # AI provider API keys (all optional — app must not crash if any are missing)
    NVIDIA_API_KEY: Optional[str] = Field(default=None, validation_alias="NVIDIA_API_KEY")
    GEMINI_API_KEY: Optional[str] = Field(default=None, validation_alias="GEMINI_API_KEY")
    GROQ_API_KEY: Optional[str] = Field(default=None, validation_alias="GROQ_API_KEY")

    # Ollama / Llama 3.2
    OLLAMA_BASE_URL: str = Field(default="http://localhost:11434/v1", validation_alias="OLLAMA_BASE_URL")
    OLLAMA_MODEL: str = Field(default="llama3.2", validation_alias="OLLAMA_MODEL")
    OLLAMA_API_KEY: str = Field(default="ollama", validation_alias="OLLAMA_API_KEY")

    # Faster-Whisper
    WHISPER_MODEL: str = Field(default="small", validation_alias="WHISPER_MODEL")
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

    # CORS — allow Vercel deployments, ngrok, cloudflare tunnels, and local dev
    CORS_ORIGINS: list[str] = Field(
        default=[
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5174",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
        ],
        validation_alias="CORS_ORIGINS",
    )

    # Server-to-server auth: Vercel proxy must send this as `Authorization: Bearer <token>`
    INTERNAL_API_TOKEN: str = Field(default="", validation_alias="INTERNAL_API_TOKEN")

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
