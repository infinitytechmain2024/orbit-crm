import io
import logging
import tempfile
from pathlib import Path
from typing import BinaryIO

from faster_whisper import WhisperModel

from backend.config import settings

logger = logging.getLogger(__name__)


class STTService:
    def __init__(self):
        self._model: WhisperModel | None = None
        self._model_name = settings.WHISPER_MODEL
        self._device = settings.WHISPER_DEVICE
        self._compute_type = settings.WHISPER_COMPUTE_TYPE
        self._language = settings.WHISPER_LANGUAGE

    def _load_model(self) -> WhisperModel:
        if self._model is None:
            logger.info(
                f"Loading Faster-Whisper model: {self._model_name} "
                f"(device={self._device}, compute_type={self._compute_type})"
            )
            self._model = WhisperModel(
                self._model_name,
                device=self._device,
                compute_type=self._compute_type,
                download_root=str(Path.home() / ".cache" / "faster-whisper"),
            )
        return self._model

    async def transcribe(self, audio_file: BinaryIO, filename: str = "audio.webm") -> str:
        """
        Transcribe audio file to text using Faster-Whisper.
        
        Args:
            audio_file: Binary file-like object (webm, wav, mp3, etc.)
            filename: Original filename for format detection
            
        Returns:
            Transcribed text
        """
        model = self._load_model()
        
        suffix = Path(filename).suffix or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            content = audio_file.read()
            tmp.write(content)
            tmp_path = tmp.name
        
        try:
            logger.info(f"Transcribing {filename} ({len(content)} bytes)")
            segments, info = model.transcribe(
                tmp_path,
                language=self._language,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500),
            )
            
            text = " ".join(segment.text for segment in segments).strip()
            logger.info(f"Transcription completed: {len(text)} chars, language={info.language}, probability={info.language_probability:.2f}")
            return text
            
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    async def transcribe_bytes(self, audio_bytes: bytes, filename: str = "audio.webm") -> str:
        """Transcribe from raw bytes."""
        return await self.transcribe(io.BytesIO(audio_bytes), filename)


stt_service = STTService()