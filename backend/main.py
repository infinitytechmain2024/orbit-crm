"""Orbit CRM Backend — FastAPI application.

Endpoints:
  POST /api/voice/transcribe  — Transcribe audio via Faster-Whisper
  POST /api/voice/process     — Full pipeline: transcribe + classify intent
  POST /api/leads/search      — Start a lead search job (OpenManus)
  GET  /api/leads/search/:id  — Get search job status
  GET  /api/health            — Health check
"""

import logging
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from backend.config import settings
from backend.services.stt import stt_service
from backend.services.ai_dispatcher import ai_dispatcher
from backend.services.intent_executor import execute_intent, ExecutionResult

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Orbit CRM Backend",
    description="AI-powered voice processing and lead generation backend",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


class LeadSearchRequest(BaseModel):
    user_id: str
    organization_id: str
    city: str
    niche: str
    max_results: int = 20


class LeadSearchResponse(BaseModel):
    job_id: str
    status: str
    message: str


# ============================
# Endpoints
# ============================

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "orbit-crm-backend"}


@app.post("/api/voice/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: str = Form(default="ru"),
):
    """Transcribe audio file to text using Faster-Whisper."""
    try:
        content = await audio.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty audio file")

        import io
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
):
    """Full voice pipeline: transcribe audio -> classify intent -> return suggestions."""
    try:
        content = await audio.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Empty audio file")

        import io
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


@app.post("/api/leads/search", response_model=LeadSearchResponse)
async def start_lead_search(request: LeadSearchRequest):
    """Start a lead search job using OpenManus browser agent."""
    try:
        from backend.services.supabase_client import supabase_service

        # Create job record in Supabase
        result = supabase_service.client.table("lead_search_jobs").insert({
            "user_id": request.user_id,
            "organization_id": request.organization_id,
            "city": request.city,
            "niche": request.niche,
            "max_results": request.max_results,
            "status": "queued",
            "raw_request": f"Поиск лидов: {request.niche} в {request.city}",
        }).execute()

        if result.data:
            job = result.data[0]
            return LeadSearchResponse(
                job_id=job["id"],
                status="queued",
                message=f"Search queued: {request.niche} in {request.city}",
            )
        raise Exception("No data returned from insert")
    except Exception as e:
        logger.error(f"Lead search failed: {e}")
        raise HTTPException(status_code=500, detail=f"Lead search failed: {str(e)}")


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
