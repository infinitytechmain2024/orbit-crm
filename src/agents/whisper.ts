import type { TranscriptionResult } from "../types/voice";

const BACKEND_API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const COMMON_HEADERS = {
  "ngrok-skip-browser-warning": "true",
};

type RawTranscription = {
  text?: string;
  transcript?: string;
  success?: boolean;
  language?: string;
};

async function tryTranscribeEndpoint(
  url: string,
  audioBlob: Blob,
  controller: AbortController,
): Promise<RawTranscription | null> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  const response = await fetch(url, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: formData,
    signal: controller.signal,
  });

  console.log(`[whisper] ${url} -> status ${response.status}`);

  if (!response.ok) {
    // Surface the reason instead of swallowing it silently.
    const errorBody = await response.text().catch(() => "Unknown error");
    console.error(`[whisper] ${url} HTTP error`, response.status, errorBody);
    throw new Error(`Transcription failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as RawTranscription;
  console.log(`[whisper] ${url} parsed response`, data);
  return data;
}

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

  // The repo ships TWO Whisper backends with different paths/response shapes:
  //   backend/main.py (router)  -> /api/speech/transcribe -> { text, success, language }
  //   whisper/main.py           -> /api/voice/stt         -> { transcript, language }
  // Try the primary first, then fall back so the feature works regardless of
  // which backend is actually running.
  const endpoints = [`${BACKEND_API}/api/speech/transcribe`, `${BACKEND_API}/api/voice/stt`];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let lastError: unknown = null;
    for (const url of endpoints) {
      try {
        const data = await tryTranscribeEndpoint(url, audioBlob, controller);
        const text = (data?.text ?? data?.transcript ?? "").trim();
        if (!text) {
          console.warn(`[whisper] ${url} returned an empty transcript`);
          continue; // try next endpoint
        }
        return { text, language: data?.language };
      } catch (err) {
        lastError = err;
        // Abort means the whole operation timed out — stop trying.
        if (controller.signal.aborted) break;
      }
    }

    if (controller.signal.aborted) {
      console.error("[whisper] request timed out after", timeoutMs, "ms");
      throw new Error("Transcription timed out — the model may be overloaded");
    }
    if (lastError) throw lastError;
    throw new Error("Whisper returned an empty transcript from all endpoints");
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
