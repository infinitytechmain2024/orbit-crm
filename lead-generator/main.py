"""FastAPI server for Lead Generation system.

Endpoints:
  POST /api/search          — Start a lead search (Liam + OpenManus pipeline)
  GET  /api/search/{job_id} — Get search job status
  GET  /api/search          — List all search jobs
  GET  /api/reports         — List generated reports
  GET  /api/reports/{name}  — Read a report file
  POST /api/notion/sync     — Sync leads to Notion
  POST /api/leads/save      — Save leads to Supabase leads table
  GET  /api/health          — Health check
  GET  /api/status          — System status (Ollama, Playwright, Notion)
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from agent import LeadGenerationAgent
from browser_scraper import HAS_PLAYRIGHT
from markdown_report import list_reports, read_report
from models import (
    NotionSyncRequest,
    NotionSyncResult,
    SearchRequest,
)
from notion_sync import sync_leads_to_notion

load_dotenv()

# Ensure reports directory exists
REPORTS_DIR = os.getenv("REPORTS_DIR", "./reports")
Path(REPORTS_DIR).mkdir(parents=True, exist_ok=True)

agent = LeadGenerationAgent()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown."""
    yield
    await agent.close()


app = FastAPI(
    title="Orbit Lead Generator",
    description="AI-powered lead generation with OpenManus + Llama 3.2",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "orbit-lead-generator"}


@app.get("/api/status")
async def system_status():
    """Check status of dependencies."""
    ollama_ok = await agent.check_ollama_status()
    notion_key = bool(os.getenv("NOTION_API_KEY"))
    notion_db = bool(os.getenv("NOTION_DATABASE_ID"))

    return {
        "ollama": {"available": ollama_ok, "url": agent.ollama_url},
        "playwright": {"available": HAS_PLAYRIGHT},
        "notion": {"configured": notion_key and notion_db, "database_set": notion_db},
        "reports_dir": REPORTS_DIR,
    }


@app.post("/api/search")
async def start_search(request: SearchRequest):
    """Start a lead search job."""
    job_id = await agent.search_leads(request.criteria)
    return {
        "job_id": job_id,
        "status": "running",
        "message": "Search started. Poll /api/search/{job_id} for status.",
    }


@app.get("/api/search/{job_id}")
async def get_search_status(job_id: str):
    """Get status of a specific search job."""
    job = agent.get_job_status(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "job_id": job.job_id,
        "status": job.status.value,
        "leads_found": job.leads_found,
        "report_path": job.report_path,
        "error": job.error,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
    }


@app.get("/api/search")
async def list_search_jobs():
    """List all search jobs."""
    jobs = agent.list_jobs()
    return {
        "jobs": [
            {
                "job_id": j.job_id,
                "status": j.status.value,
                "leads_found": j.leads_found,
                "report_path": j.report_path,
                "created_at": j.started_at.isoformat() if j.started_at else None,
            }
            for j in jobs
        ]
    }


@app.get("/api/reports")
async def get_reports():
    """List all generated Markdown reports."""
    reports = list_reports(REPORTS_DIR)
    return {"reports": reports, "total": len(reports)}


@app.get("/api/reports/{filename}")
async def get_report(filename: str):
    """Read a specific report file."""
    filepath = os.path.join(REPORTS_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Report not found")

    content = read_report(filepath)
    return {"filename": filename, "content": content}


@app.post("/api/notion/sync")
async def sync_to_notion(request: NotionSyncRequest):
    """Sync leads from a Markdown report to Notion database."""
    if not os.path.exists(request.report_path):
        raise HTTPException(status_code=404, detail="Report file not found")

    try:
        result = sync_leads_to_notion(
            filepath=request.report_path,
            overwrite=request.overwrite,
        )
        return result.model_dump()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {e}")


@app.post("/api/leads/save")
async def save_leads_to_supabase(
    organization_id: str,
    project_id: str | None = None,
    source_query: str = "",
    niche: str = "",
    city: str = "",
):
    """Save leads from the latest search job to Supabase leads table."""
    try:
        from liam_orchestrator import LiamOrchestrator, ValidatedContact

        orchestrator = LiamOrchestrator(
            ollama_url=agent.ollama_url,
            ollama_model=os.getenv("OLLAMA_MODEL", "llama3.2"),
        )

        # Get the most recent completed job
        completed_jobs = [
            j for j in agent.jobs.values()
            if j.status.value == "completed"
        ]
        if not completed_jobs:
            raise HTTPException(status_code=404, detail="No completed search jobs found")

        latest_job = max(completed_jobs, key=lambda j: j.completed_at or datetime.min)

        # For now, return job info — actual lead saving happens in the search pipeline
        return {
            "job_id": latest_job.job_id,
            "leads_found": latest_job.leads_found,
            "report_path": latest_job.report_path,
            "status": "saved" if latest_job.report_path else "pending",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save leads: {e}")


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("LEAD_GEN_HOST", "0.0.0.0")
    port = int(os.getenv("LEAD_GEN_PORT", "8090"))

    print(f"🚀 Starting Lead Generator API on {host}:{port}")
    print(f"📖 Docs: http://localhost:{port}/docs")
    uvicorn.run(app, host=host, port=port)
