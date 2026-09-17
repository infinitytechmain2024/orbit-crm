from __future__ import annotations

"""Orbit CRM Backend — FastAPI application.

Endpoints:
  POST /api/speech/transcribe   — Transcribe audio via local Faster-Whisper
  POST /api/voice/stt           — Transcribe audio via Faster-Whisper
  POST /api/voice/process       — Full pipeline: transcribe + classify intent
  POST /api/voice/execute       — Execute a classified intent
  POST /api/agent/process       — Process text/voice commands via Liam agent
  GET  /api/clients             — Get clients from Supabase
  POST /api/clients             — Create a client in Supabase
  GET  /api/appointments        — Get appointments from Supabase
  POST /api/appointments        — Create an appointment in Supabase
  POST /api/leads/search        — Start a lead search job
  GET  /api/leads/search/:id    — Get search job status
  GET  /api/health              — Health check
"""

import asyncio
import io
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from backend.config import settings
from backend.routers import agent_router
from backend.routers.assistant import router as assistant_router
from backend.routers.ai_workflow import router as ai_workflow_api_router
from backend.routers.ai_router import router as ai_router
from backend.routers.ceo import router as ceo_router
from backend.routers.websocket import router as websocket_router
from backend.routers.company_router import router as company_router
from backend.routers.internal import router as internal_router
from backend.routers.openclaw_tasks import router as openclaw_router
from backend.routers.openclaw_goals import router as openclaw_goals_router
from backend.routers.controlled_learning import router as controlled_learning_router
from backend.routers.selfdev import router as selfdev_router
from backend.routers.whisper_router import router as whisper_router
from backend.routers.receipt_router import router as receipt_router
from backend.routers.stripe_router import router as stripe_router
from backend.middleware.rate_limit import WorkflowRateLimitMiddleware
from backend.middleware.correlation import CorrelationMiddleware
from backend.services.stt import stt_service
from backend.services.ai_dispatcher import ai_dispatcher
from backend.services.intent_executor import execute_intent, ExecutionResult
from backend.services.workflow_worker import workflow_worker
from backend.services.openclaw_client import openclaw_client
from backend.services.lead_search_pipeline import lead_search_pipeline
from backend.auth import require_workflow_actor, require_workflow_permission, WorkflowActor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

CORS_ORIGINS = list(settings.CORS_ORIGINS)
CORS_ORIGIN_REGEX = settings.CORS_ORIGIN_REGEX

# ============================
# Lifespan
# ============================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting Orbit CRM Backend...")
    # Start background worker immediately; Ollama is optional and checked lazily by ai_dispatcher
    await workflow_worker.start()
    yield
    # Shutdown
    await workflow_worker.stop()
    await openclaw_client.close()
    await ai_dispatcher.close()
    logger.info("Shutting down Orbit CRM Backend...")

# ============================
# FastAPI App
# ============================

app = FastAPI(
    title="Orbit CRM Backend",
    description="AI-powered voice processing, lead generation, and CRM backend",
    version="1.0.0",
    lifespan=lifespan,
)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """Log unexpected errors without exposing implementation details."""
    request_id = request.headers.get("x-request-id", "unknown")
    logger.exception("Unhandled exception [request_id: %s]", request_id)
    safe_detail = "Внутренняя ошибка сервера. Попробуйте позже или свяжитесь с поддержкой."
    return JSONResponse(
        status_code=500,
        content={"error": "InternalServerError", "detail": safe_detail, "request_id": request_id},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=CORS_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(WorkflowRateLimitMiddleware)
app.add_middleware(CorrelationMiddleware)

app.include_router(internal_router)
app.include_router(agent_router.router)
app.include_router(assistant_router)
app.include_router(company_router)
app.include_router(openclaw_router)
app.include_router(openclaw_goals_router)
app.include_router(controlled_learning_router)
app.include_router(selfdev_router)
app.include_router(whisper_router)
app.include_router(ai_workflow_api_router)
app.include_router(ceo_router)
app.include_router(ai_router)
app.include_router(websocket_router)
app.include_router(stripe_router)
app.include_router(receipt_router)


# ============================
# Models
# ============================

class VoiceProcessResponse(BaseModel):
    transcript: str
    intent: dict
    suggested_actions: list[str]


class IntentExecuteRequest(BaseModel):
    # Deprecated: the authenticated session decides the acting user.
    user_id: Optional[str] = None
    intent: dict


class ClientCreateRequest(BaseModel):
    organization_id: str
    name: str
    phone: str = ""
    email: str = ""
    website: str = ""
    address: str = ""
    category: str = ""
    notes: str = ""
    source: str = "manual"
    status: str = "new"


class LeadSearchRequest(BaseModel):
    # Deprecated: the authenticated session decides the acting user.
    user_id: Optional[str] = None
    organization_id: str
    city: str
    niche: str
    max_results: int = 20


class LeadSearchResponse(BaseModel):
    job_id: str
    status: str
    message: str


class UnifiedLeadSearchRequest(BaseModel):
    niche: str
    city: str
    country: str
    limit: int = 20


class SavedSearchCreateRequest(BaseModel):
    organization_id: str
    name: str
    query_niche: str
    query_city: str
    query_country: str
    query_limit: int = 20
    results: list[dict]
    total_found: int = 0


class SavedSearchDeleteRequest(BaseModel):
    organization_id: str


class AppointmentCreateRequest(BaseModel):
    title: str
    client_name: str
    start_time: str  # ISO format
    end_time: str    # ISO format
    status: str = "new"
    notes: str = ""
    client_id: Optional[str] = None


class AppointmentResponse(BaseModel):
    id: str
    title: str
    client_name: str
    start_time: str
    end_time: str
    status: str
    notes: str
    client_id: Optional[str] = None
    created_at: str


# ============================
# Endpoints
# ============================

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "orbit-crm-backend", "version": settings.APP_VERSION}


def _reject_foreign_user_id(requested_user_id: Optional[str], actor: WorkflowActor) -> None:
    """A caller may not act for another user; the verified session is authoritative."""
    if requested_user_id and requested_user_id != actor.user_id:
        raise HTTPException(status_code=403, detail="user_id does not match the authenticated user")


@app.post("/api/voice/stt")
async def speech_to_text(
    audio: UploadFile = File(...),
    language: str = Form(default="ru"),
    _actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Transcribe audio file to text using Faster-Whisper."""
    try:
        content = await audio.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty audio file")

        transcript = await stt_service.transcribe(
            io.BytesIO(content),
            filename=audio.filename or "audio.webm",
        )
        return {"transcript": transcript, "language": language}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


@app.post("/api/voice/process", response_model=VoiceProcessResponse)
async def process_voice(
    audio: UploadFile = File(...),
    _actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Full voice pipeline: transcribe audio -> classify intent -> return suggestions."""
    try:
        content = await audio.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty audio file")

        transcript = await stt_service.transcribe(
            io.BytesIO(content),
            filename=audio.filename or "audio.webm",
        )

        if not transcript.strip():
            raise HTTPException(status_code=422, detail="Could not transcribe audio")

        intent = await ai_dispatcher.classify_intent(transcript)
        suggestions = await ai_dispatcher.generate_suggestions(intent)

        return VoiceProcessResponse(
            transcript=transcript,
            intent={
                "type": intent.type,
                "entities": intent.entities,
                "rawText": intent.raw_text,
                "confidence": intent.confidence,
            },
            suggested_actions=suggestions,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Voice processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Voice processing failed: {str(e)}")


@app.post("/api/voice/execute")
async def execute_voice_intent(
    request: IntentExecuteRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Execute a classified intent (create task, project, estimate, etc.)."""
    _reject_foreign_user_id(request.user_id, actor)
    try:
        from backend.services.ai_dispatcher import Intent

        intent = Intent(
            type=request.intent.get("type", "UNKNOWN"),
            entities=request.intent.get("entities", {}),
            raw_text=request.intent.get("rawText", ""),
            confidence=float(request.intent.get("confidence", 0.5)),
        )

        result = await execute_intent(actor.user_id, intent)

        return {
            "success": result.success,
            "action": result.action,
            "result": result.result,
            "error": result.error,
        }
    except Exception as e:
        logger.error(f"Intent execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Execution failed: {str(e)}")


@app.get("/api/clients")
async def get_clients(
    organization_id: str = Query(...),
    limit: int = Query(default=50, ge=1, le=200),
    status: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Get lead clients of one organization from Supabase."""
    await require_workflow_permission(organization_id, actor, "workflow.read")
    try:
        from backend.services.supabase_client import supabase_service

        query = (
            supabase_service.client.table("lead_clients")
            .select("*")
            .eq("organization_id", organization_id)
        )

        if status:
            query = query.eq("status", status)
        if source:
            query = query.eq("source", source)

        result = query.order("created_at", desc=True).limit(limit).execute()
        return {"clients": result.data or [], "count": len(result.data or [])}
    except Exception as e:
        logger.error(f"Failed to get clients: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/clients")
async def create_client(
    request: ClientCreateRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Create a new lead client in Supabase."""
    await require_workflow_permission(request.organization_id, actor, "workflow.create")
    try:
        from backend.services.supabase_client import supabase_service

        result = supabase_service.client.table("lead_clients").insert({
            "organization_id": request.organization_id,
            "user_id": actor.user_id,
            "business_name": request.name,
            "category": request.category,
            "city_location": request.address,
            "country": "United States",
            "country_flag": "🇺🇸",
            "contact_phone": request.phone or None,
            "email": request.email or "-",
            "website_url": request.website or "-",
            "whatsapp_status": "Unverified",
            "priority": "Middle",
            "status": "Lead",
            "source": request.source,
            "source_query": request.notes,
        }).execute()

        if result.data:
            return {"client": result.data[0], "success": True}
        raise Exception("No data returned")
    except Exception as e:
        logger.error(f"Failed to create client: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/leads/search", response_model=LeadSearchResponse)
async def start_lead_search(
    request: LeadSearchRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Start a lead search job using GMaps scraper + OpenManus."""
    _reject_foreign_user_id(request.user_id, actor)
    await require_workflow_permission(request.organization_id, actor, "workflow.create")
    try:
        from backend.services.supabase_client import supabase_service

        result = supabase_service.client.table("lead_search_jobs").insert({
            "user_id": actor.user_id,
            "organization_id": request.organization_id,
            "city": request.city,
            "niche": request.niche,
            "max_results": request.max_results,
            "status": "queued",
            "raw_request": f"Search: {request.niche} in {request.city}",
        }).execute()

        if result.data:
            job = result.data[0]
            job_id = job["id"]

            # Launch background search task
            asyncio.create_task(_execute_lead_search(
                job_id=job_id,
                user_id=actor.user_id,
                city=request.city,
                niche=request.niche,
                max_results=request.max_results,
            ))

            return LeadSearchResponse(
                job_id=job_id,
                status="queued",
                message=f"Search queued: {request.niche} in {request.city}",
            )
        raise Exception("No data returned from insert")
    except Exception as e:
        logger.error(f"Lead search failed: {e}")
        raise HTTPException(status_code=500, detail=f"Lead search failed: {str(e)}")


@app.post("/api/lead-search")
async def unified_lead_search(
    request: UnifiedLeadSearchRequest,
    _actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Unified lead search pipeline for the UI."""
    try:
        capped_limit = min(max(1, request.limit), 100)
        leads = await lead_search_pipeline.search(
            niche=request.niche,
            city=request.city,
            country=request.country,
            limit=capped_limit,
        )
        return {
            "leads": leads,
            "total": len(leads),
            "query": {
                "niche": request.niche,
                "city": request.city,
                "country": request.country,
                "limit": capped_limit,
            },
            "pipeline": ["google_maps_browser", "openmanus"],
        }
    except Exception as e:
        logger.error(f"Unified lead search failed: {e}")
        raise HTTPException(status_code=500, detail=f"Lead search failed: {str(e)}")


@app.get("/api/saved-searches")
async def list_saved_searches(
    organization_id: str = Query(...),
    limit: int = Query(default=20, ge=1, le=100),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    try:
        await require_workflow_permission(organization_id, actor, "workflow.read")
        from backend.services.supabase_client import supabase_service

        result = (
            supabase_service.client.table("saved_searches")
            .select("*")
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"saved_searches": result.data or []}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to list saved searches: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to list saved searches: {str(e)}")


@app.post("/api/saved-searches")
async def create_saved_search(
    request: SavedSearchCreateRequest,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    try:
        await require_workflow_permission(request.organization_id, actor, "workflow.create")
        from backend.services.supabase_client import supabase_service

        result = supabase_service.client.table("saved_searches").insert({
            "organization_id": request.organization_id,
            "user_id": actor.user_id,
            "name": request.name,
            "query_niche": request.query_niche,
            "query_city": request.query_city,
            "query_country": request.query_country,
            "query_limit": request.query_limit,
            "results": request.results,
            "total_found": request.total_found,
        }).execute()
        if result.data:
            return {"saved_search": result.data[0]}
        raise Exception("No data returned")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to create saved search: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create saved search: {str(e)}")


@app.delete("/api/saved-searches/{saved_search_id}")
async def delete_saved_search(
    saved_search_id: str,
    organization_id: str = Query(...),
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    try:
        await require_workflow_permission(organization_id, actor, "workflow.create")
        from backend.services.supabase_client import supabase_service

        result = (
            supabase_service.client.table("saved_searches")
            .delete()
            .eq("id", saved_search_id)
            .eq("organization_id", organization_id)
            .execute()
        )
        return {"deleted": True, "data": result.data or []}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete saved search: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete saved search: {str(e)}")


async def _execute_lead_search(
    job_id: str,
    user_id: str,
    city: str,
    niche: str,
    max_results: int,
):
    """Background task: execute the actual lead search via GMaps + Manus."""
    from backend.services.supabase_client import supabase_service

    try:
        # Mark as running
        supabase_service.client.table("lead_search_jobs").update({
            "status": "running",
            "started_at": "now()",
        }).eq("id", job_id).execute()

        # Try GMaps Docker scraper first
        result = None
        try:
            from backend.tools.gmaps_tool import gmaps_tool
            result = await gmaps_tool.execute(
                keywords=niche,
                location=city,
                limit=max_results,
            )
            if not result.success:
                logger.warning(f"GMaps Docker scraper failed: {result.error}, trying browser")
                result = None
        except Exception as e:
            logger.warning(f"GMaps Docker scraper unavailable: {e}")

        # Fallback: browser-based Google Maps scraping
        if result is None or not result.success:
            try:
                from backend.tools.gmaps_browser_scraper import search_google_maps_browser
                browser_leads = await search_google_maps_browser(
                    niche=niche,
                    city=city,
                    limit=max_results,
                    headless=True,
                )
                if browser_leads:
                    from dataclasses import dataclass
                    @dataclass
                    class BrowserResult:
                        success: bool
                        leads: list
                        count: int
                        error: str | None = None
                    result = BrowserResult(success=True, leads=browser_leads, count=len(browser_leads))
                else:
                    raise Exception("Browser search returned no results")
            except Exception as e2:
                logger.error(f"Browser search also failed: {e2}")
                supabase_service.client.table("lead_search_jobs").update({
                    "status": "failed",
                    "error": f"GMaps scraper and browser search both failed: {e2}",
                    "completed_at": "now()",
                }).eq("id", job_id).execute()
                return

        # Save leads to lead_clients table
        saved = 0
        for lead in result.leads:
            try:
                emails = lead.get("emails", "") or lead.get("email", "")
                first_email = emails.split(",")[0].strip() if emails else "-"
                website = lead.get("website", "").strip() or "-"
                phone = lead.get("phone", "").strip() or None

                supabase_service.client.table("lead_clients").insert({
                    "user_id": user_id,
                    "business_name": lead.get("title", "") or lead.get("business_name", "Unknown"),
                    "category": lead.get("category", ""),
                    "city_location": city,
                    "country": "United States",
                    "country_flag": "🇺🇸",
                    "contact_phone": phone,
                    "email": first_email,
                    "website_url": website,
                    "whatsapp_status": "Unverified",
                    "priority": "Middle",
                    "status": "Lead",
                    "website_status_type": "good" if website != "-" else "no_website",
                    "source": lead.get("source", "google_maps"),
                    "source_query": f"{niche} in {city}",
                }).execute()
                saved += 1
            except Exception as e:
                logger.warning(f"Failed to save lead '{lead.get('title', lead.get('business_name', ''))}': {e}")

        # Mark as completed
        supabase_service.client.table("lead_search_jobs").update({
            "status": "completed",
            "leads_found": saved,
            "completed_at": "now()",
        }).eq("id", job_id).execute()

        logger.info(f"Lead search {job_id} completed: {saved} leads saved")

    except Exception as e:
        logger.error(f"Lead search {job_id} failed: {e}")
        try:
            supabase_service.client.table("lead_search_jobs").update({
                "status": "failed",
                "error": str(e),
                "completed_at": "now()",
            }).eq("id", job_id).execute()
        except Exception:
            pass


@app.get("/api/leads/search/{job_id}")
async def get_lead_search_status(
    job_id: str,
    actor: WorkflowActor = Depends(require_workflow_actor),
):
    """Get status of a lead search job."""
    try:
        from backend.services.supabase_client import supabase_service

        result = (
            supabase_service.client.table("lead_search_jobs")
            .select("*")
            .eq("id", job_id)
            .limit(1)
            .execute()
        )
        job = (result.data or [None])[0]
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if str(job.get("user_id")) != actor.user_id:
            if not job.get("organization_id"):
                raise HTTPException(status_code=404, detail="Job not found")
            await require_workflow_permission(str(job["organization_id"]), actor, "workflow.read")
        return job
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get job status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    print(f"🚀 Starting Orbit CRM Backend on {settings.HOST}:{settings.PORT}")
    print(f"📖 Docs: http://localhost:{settings.PORT}/docs")
    uvicorn.run(app, host=settings.HOST, port=settings.PORT)
