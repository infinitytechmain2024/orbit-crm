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
  GET  /api/system/health       — Health check (Ollama, Supabase)
"""

import asyncio
import io
import logging
import subprocess
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.config import settings
from backend.routers import agent_router
from backend.routers.ai_workflow import router as ai_workflow_api_router
from backend.routers.ceo import router as ceo_router
from backend.routers.company_router import router as company_router
from backend.routers.internal import router as internal_router
from backend.routers.whisper_router import router as whisper_router
from backend.middleware.rate_limit import WorkflowRateLimitMiddleware
from backend.services.stt import stt_service
from backend.services.ai_dispatcher import ai_dispatcher
from backend.services.intent_executor import execute_intent, ExecutionResult
from backend.services.workflow_worker import workflow_worker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Dynamically build CORS origins — include Vercel preview URLs and tunnel domains
CORS_ORIGINS = list(settings.CORS_ORIGINS) + [
    "https://*.vercel.app",
    "https://*.trycloudflare.com",
    "https://*.ngrok-free.app",
    "https://*.ngrok.io",
]

# ============================
# Ollama Auto-Start
# ============================

async def ensure_ollama_running():
    """Check if Ollama is running, start if not."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{settings.OLLAMA_BASE_URL.replace('/v1', '')}/api/tags")
            if response.status_code == 200:
                logger.info("Ollama is already running")
                return True
    except Exception:
        logger.info("Ollama not responding, attempting to start...")

    try:
        # Start ollama serve in background
        if sys.platform == "win32":
            subprocess.Popen(
                ["ollama", "serve"],
                creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        else:
            subprocess.Popen(
                ["ollama", "serve"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        logger.info("Started ollama serve in background")

        # Wait for Ollama to be ready
        for _ in range(30):
            await asyncio.sleep(1)
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    response = await client.get(f"{settings.OLLAMA_BASE_URL.replace('/v1', '')}/api/tags")
                    if response.status_code == 200:
                        logger.info("Ollama started successfully")
                        return True
            except Exception:
                continue
        logger.warning("Ollama did not start within 30 seconds")
        return False
    except Exception as e:
        logger.error(f"Failed to start Ollama: {e}")
        return False

# ============================
# Lifespan
# ============================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting Orbit CRM Backend...")
    await ensure_ollama_running()
    await workflow_worker.start()
    yield
    # Shutdown
    await workflow_worker.stop()
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.(vercel\.app|trycloudflare\.com|ngrok-free\.app|ngrok\.io)$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(WorkflowRateLimitMiddleware)

app.include_router(internal_router)
app.include_router(agent_router.router)
app.include_router(company_router)
app.include_router(whisper_router)
app.include_router(ai_workflow_api_router)
app.include_router(ceo_router)


# ============================
# Models
# ============================

class VoiceProcessResponse(BaseModel):
    transcript: str
    intent: dict
    suggested_actions: list[str]


class IntentExecuteRequest(BaseModel):
    user_id: str
    intent: dict


class ClientCreateRequest(BaseModel):
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
    user_id: str
    organization_id: str = ""
    city: str
    niche: str
    max_results: int = 20


class LeadSearchResponse(BaseModel):
    job_id: str
    status: str
    message: str


class HealthResponse(BaseModel):
    status: str
    ollama: dict
    supabase: dict
    version: str


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


@app.post("/api/voice/stt")
async def speech_to_text(
    audio: UploadFile = File(...),
    language: str = Form(default="ru"),
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
async def process_voice(audio: UploadFile = File(...)):
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
async def execute_voice_intent(request: IntentExecuteRequest):
    """Execute a classified intent (create task, project, estimate, etc.)."""
    try:
        from backend.services.ai_dispatcher import Intent

        intent = Intent(
            type=request.intent.get("type", "UNKNOWN"),
            entities=request.intent.get("entities", {}),
            raw_text=request.intent.get("rawText", ""),
            confidence=float(request.intent.get("confidence", 0.5)),
        )

        result = await execute_intent(request.user_id, intent)

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
    limit: int = Query(default=50, ge=1, le=200),
    status: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
):
    """Get lead clients from Supabase."""
    try:
        from backend.services.supabase_client import supabase_service

        query = supabase_service.client.table("lead_clients").select("*")

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
async def create_client(request: ClientCreateRequest):
    """Create a new lead client in Supabase."""
    try:
        from backend.services.supabase_client import supabase_service

        result = supabase_service.client.table("lead_clients").insert({
            "user_id": "00000000-0000-0000-0000-000000000000",  # placeholder, should come from auth
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
async def start_lead_search(request: LeadSearchRequest):
    """Start a lead search job using GMaps scraper + OpenManus."""
    try:
        from backend.services.supabase_client import supabase_service

        result = supabase_service.client.table("lead_search_jobs").insert({
            "user_id": request.user_id,
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
                user_id=request.user_id,
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

        # Run GMaps search
        from backend.tools.gmaps_tool import gmaps_tool
        result = await gmaps_tool.execute(
            keywords=niche,
            location=city,
            limit=max_results,
        )

        if not result.success:
            supabase_service.client.table("lead_search_jobs").update({
                "status": "failed",
                "error": result.error,
                "completed_at": "now()",
            }).eq("id", job_id).execute()
            return

        # Save leads to lead_clients table
        saved = 0
        for lead in result.leads:
            try:
                emails = lead.get("emails", "")
                first_email = emails.split(",")[0].strip() if emails else "-"
                website = lead.get("website", "").strip() or "-"
                phone = lead.get("phone", "").strip() or None

                supabase_service.client.table("lead_clients").insert({
                    "user_id": user_id,
                    "business_name": lead.get("title", "Unknown"),
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
                    "source": "google_maps",
                    "source_query": f"{niche} in {city}",
                }).execute()
                saved += 1
            except Exception as e:
                logger.warning(f"Failed to save lead '{lead.get('title')}': {e}")

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
async def get_lead_search_status(job_id: str):
    """Get status of a lead search job."""
    try:
        from backend.services.supabase_client import supabase_service

        result = supabase_service.client.table("lead_search_jobs") \
            .select("*") \
            .eq("id", job_id) \
            .single()

        if result.data:
            return result.data
        raise HTTPException(status_code=404, detail="Job not found")
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
