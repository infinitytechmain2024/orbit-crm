"""Pydantic models for Lead Generator API."""

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class LeadStatus(str, Enum):
    NEW = "new"
    CONTACTED = "contacted"
    QUALIFIED = "qualified"
    CONVERTED = "converted"
    REJECTED = "rejected"


class SearchCriteria(BaseModel):
    industry: str = Field(..., description="Target industry (e.g., 'wellness', 'fitness', 'beauty')")
    location: str = Field(default="Russia", description="Target geographic location")
    company_size: str = Field(default="any", description="Company size filter")
    keywords: list[str] = Field(default_factory=list, description="Additional search keywords")
    max_results: int = Field(default=20, ge=1, le=100, description="Maximum leads to find")


class Lead(BaseModel):
    id: Optional[str] = None
    name: str
    company: str = ""
    industry: str = ""
    location: str = ""
    email: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    linkedin: Optional[str] = None
    description: str = ""
    icp_score: int = Field(default=5, ge=1, le=10, description="ICP fit score 1-10")
    analysis: str = ""
    outreach_approach: str = ""
    source_url: Optional[str] = None
    status: LeadStatus = LeadStatus.NEW
    notion_page_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)


class SearchRequest(BaseModel):
    criteria: SearchCriteria


class SearchStatus(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class SearchJob(BaseModel):
    job_id: str
    status: SearchStatus
    criteria: SearchCriteria
    leads_found: int = 0
    report_path: Optional[str] = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class ReportSummary(BaseModel):
    total_leads: int
    avg_icp_score: float
    top_industries: list[str]
    report_path: str
    generated_at: datetime


class NotionSyncRequest(BaseModel):
    report_path: str
    overwrite: bool = False


class NotionSyncResult(BaseModel):
    synced: int
    skipped: int
    errors: int
    database_url: str
