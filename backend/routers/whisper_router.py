"""Speech-to-text API backed by the repository's local faster-whisper source."""

from __future__ import annotations

import logging
import sys
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool


logger = logging.getLogger(__name__)

router = APIRouter(tags=["Speech"])

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


class TranscriptionResponse(BaseModel):
    text: str
    success: bool
    language: str


def _transcribe_file(file_path: Path) -> tuple[str, str]:
    """Run the blocking CPU transcription outside the async event loop."""
    if whisper_model is None:
        raise RuntimeError("Whisper model is not initialized")

    segments, info = whisper_model.transcribe(
        str(file_path),
        beam_size=5,
        vad_filter=True,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    language = info.language or "unknown"
    return text, language


@router.post("/api/speech/transcribe", response_model=TranscriptionResponse)
async def transcribe_speech(audio: UploadFile = File(...)) -> TranscriptionResponse:
    """Save an uploaded recording temporarily and return its transcription."""
    if whisper_model is None:
        logger.error(
            "Transcription requested while the model is unavailable: %s",
            model_initialization_error,
        )
        raise HTTPException(
            status_code=503,
            detail="Whisper model is unavailable; check the backend logs",
        )

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

        text, language = await run_in_threadpool(_transcribe_file, temporary_path)
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
