"""Orbit CRM — Whisper Voice Backend (port 8000).

Endpoints:
  POST /api/voice/stt    — Transcribe audio → text (Faster-Whisper)
  GET  /api/health       — Health check
"""

import io
import logging
import os
import tempfile
import shutil
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("whisper-backend")

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Orbit CRM Whisper Backend", version="1.0.0")

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Whisper model (lazy load)
# ---------------------------------------------------------------------------

_whisper_model = None
_model_lock = __import__("threading").Lock()

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_LANG = os.getenv("WHISPER_LANGUAGE", "ru")
CACHE_DIR = os.getenv("WHISPER_CACHE_DIR", str(Path.home() / ".cache" / "faster-whisper"))


def _get_model():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    with _model_lock:
        if _whisper_model is not None:
            return _whisper_model
        logger.info(
            "Loading Faster-Whisper model=%s device=%s compute=%s",
            WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE,
        )
        from faster_whisper import WhisperModel

        _whisper_model = WhisperModel(
            WHISPER_MODEL,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE,
            download_root=CACHE_DIR,
        )
        logger.info("Whisper model loaded")
        return _whisper_model


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    ffmpeg_ok = shutil.which("ffmpeg") is not None
    return {
        "status": "ok",
        "service": "whisper-backend",
        "model": WHISPER_MODEL,
        "device": WHISPER_DEVICE,
        "ffmpeg": ffmpeg_ok,
    }


@app.post("/api/voice/stt")
async def speech_to_text(audio: UploadFile = File(...)):
    """Transcribe audio blob to text.

    Accepts any format faster-whisper / ffmpeg can handle:
    webm, mp3, wav, ogg, m4a, etc.
    """
    if audio.content_type and "video" in audio.content_type:
        raise HTTPException(status_code=400, detail="Video files are not supported. Send audio only.")

    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty audio file")

    suffix = Path(audio.filename or "audio.webm").suffix or ".webm"

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        model = _get_model()
        segments, info = model.transcribe(
            tmp_path,
            language=WHISPER_LANG,
            beam_size=5,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=500),
        )
        text = " ".join(seg.text for seg in segments).strip()

        logger.info(
            "Transcribed %d bytes → %d chars (lang=%s prob=%.2f)",
            len(content), len(text), info.language, info.language_probability,
        )

        return {
            "transcript": text,
            "language": info.language,
            "duration": info.duration,
        }

    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="faster-whisper not installed. Run: pip install faster-whisper",
        )
    except RuntimeError as e:
        msg = str(e).lower()
        if "ffmpeg" in msg or "av" in msg:
            raise HTTPException(
                status_code=500,
                detail="FFmpeg not installed or invalid audio format. Install ffmpeg: brew install ffmpeg",
            )
        raise HTTPException(status_code=500, detail=f"Whisper runtime error: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Transcription failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    print(f"🎤 Whisper backend starting on {host}:{port}")
    print(f"📖 Docs: http://localhost:{port}/docs")
    uvicorn.run(app, host=host, port=port)
