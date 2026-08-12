"""Speech-to-text API backed by the repository's local faster-whisper source."""

from __future__ import annotations

import logging
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool


logger = logging.getLogger(__name__)

router = APIRouter(tags=["Speech"])

logging.getLogger("faster_whisper").setLevel(logging.WARNING)

# The repository contains faster-whisper's sources in <repo>/whisper.  Put that
# directory first so this router does not accidentally import a separately
# installed copy of the package.
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
LOCAL_WHISPER_ROOT = REPOSITORY_ROOT / "whisper"
local_whisper_path = str(LOCAL_WHISPER_ROOT)
if local_whisper_path not in sys.path:
    sys.path.insert(0, local_whisper_path)

MODEL_SIZE = "base"
DEVICE = "cpu"
COMPUTE_TYPE = "int8"

whisper_model: Any | None = None
model_initialization_error: Exception | None = None


def _load_model() -> Any:
    """Lazily load the model on first request instead of at import time.

    Loading at import blocks startup and can take the whole app down if the
    model or its dependencies fail to initialise. Lazily loading surfaces the
    failure as a clear 503 on the transcription endpoint only.
    """
    global whisper_model, model_initialization_error
    if whisper_model is not None:
        return whisper_model
    try:
        from faster_whisper import WhisperModel

        whisper_model = WhisperModel(
            MODEL_SIZE,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
        )
        logger.info(
            "Local Faster-Whisper model initialized: model=%s, device=%s, compute_type=%s",
            MODEL_SIZE,
            DEVICE,
            COMPUTE_TYPE,
        )
    except Exception as exc:  # Keep the rest of the FastAPI application available.
        model_initialization_error = exc
        logger.exception("Failed to initialize the local Faster-Whisper model")
        raise
    return whisper_model


class TranscriptionResponse(BaseModel):
    text: str
    success: bool
    language: str


def _transcribe_file(file_path: Path) -> tuple[str, str]:
    """Run the blocking CPU transcription outside the async event loop."""
    model = _load_model()
    if model is None:
        raise RuntimeError("Whisper model is not initialized")

    started = time.monotonic()
    segments, info = model.transcribe(
        str(file_path),
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=300),
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    duration = time.monotonic() - started
    logger.info(
        "Transcription finished: language=%s chars=%d duration=%.2fs",
        info.language or "unknown",
        len(text),
        duration,
    )
    return text, info.language or "unknown"


@router.post("/api/speech/transcribe", response_model=TranscriptionResponse)
async def transcribe_speech(audio: UploadFile = File(...)) -> TranscriptionResponse:
    """Save an uploaded recording temporarily and return its transcription."""
    try:
        _load_model()
    except Exception as exc:
        logger.error("Transcription requested while the model is unavailable: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"Whisper model is unavailable: {exc}",
        ) from exc

    suffix = Path(audio.filename or "recording.webm").suffix.lower()
    if not suffix or len(suffix) > 10 or not suffix[1:].isalnum():
        suffix = ".webm"

    temporary_path: Path | None = None

    try:
        uploaded_bytes = 0
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as temporary_file:
            temporary_path = Path(temporary_file.name)
            while chunk := await audio.read(1024 * 1024):
                uploaded_bytes += len(chunk)
                temporary_file.write(chunk)

        if uploaded_bytes == 0:
            raise HTTPException(status_code=400, detail="Uploaded audio file is empty")

        logger.info("Received audio for transcription: %d bytes", uploaded_bytes)
        text, language = await run_in_threadpool(_transcribe_file, temporary_path)

        # Surface empty results as a 422 so the frontend can tell the user
        # "no speech detected" instead of silently dropping the transcript.
        if not text:
            raise HTTPException(
                status_code=422,
                detail="No speech detected in the audio",
            )

        return TranscriptionResponse(text=text, success=True, language=language)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Audio transcription failed")
        raise HTTPException(status_code=500, detail="Audio transcription failed") from exc
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                logger.exception("Failed to delete temporary audio file: %s", temporary_path)
        try:
            await audio.close()
        except OSError:
            logger.exception("Failed to close the uploaded audio file")
