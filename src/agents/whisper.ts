import type { TranscriptionResult } from "../types/voice";

const BACKEND_API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const COMMON_HEADERS = {
  "ngrok-skip-browser-warning": "true",
};

export async function transcribeAudio(
  audioBlob: Blob,
  timeoutMs = 60000,
): Promise<TranscriptionResult> {
  console.log("[whisper] transcribe start", {
    size: audioBlob.size,
    type: audioBlob.type,
  });

  if (audioBlob.size === 0) {
    throw new Error("Cannot transcribe: audio blob is empty");
  }

  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BACKEND_API}/api/speech/transcribe`, {
      method: "POST",
      headers: COMMON_HEADERS,
      body: formData,
      signal: controller.signal,
    });

    console.log("[whisper] response status", response.status);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "Unknown error");
      console.error("[whisper] HTTP error", response.status, errorBody);
      throw new Error(`Transcription failed (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      text?: string;
      transcript?: string;
      success?: boolean;
      language?: string;
    };

    console.log("[whisper] parsed response", data);

    const text = (data.text ?? data.transcript ?? "").trim();
    if (!text) {
      throw new Error("Whisper returned an empty transcript");
    }

    return {
      text,
      language: data.language,
    };
  } catch (err) {
    if (controller.signal.aborted) {
      console.error("[whisper] request timed out after", timeoutMs, "ms");
      throw new Error("Transcription timed out — the model may be overloaded");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkWhisperHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_API}/api/health`, {
      headers: COMMON_HEADERS,
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { status: string };
    return data.status === "ok";
  } catch {
    return false;
  }
}
