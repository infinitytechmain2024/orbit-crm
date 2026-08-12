import type { TranscriptionResult } from "../types/voice";

const CONFIGURED_BACKEND_API = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
const LOCAL_BACKEND_API = "http://localhost:8000";

const COMMON_HEADERS = {
  "ngrok-skip-browser-warning": "true",
};

type RawTranscription = {
  text?: string;
  transcript?: string;
  success?: boolean;
  language?: string;
};

class TranscriptionHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TranscriptionHttpError";
  }
}

function audioFileName(mimeType: string): string {
  if (mimeType.includes("ogg")) return "recording.ogg";
  if (mimeType.includes("mp4")) return "recording.mp4";
  if (mimeType.includes("wav")) return "recording.wav";
  return "recording.webm";
}

function transcriptionEndpoints(): string[] {
  const endpoints: string[] = [];

  if (CONFIGURED_BACKEND_API) {
    endpoints.push(
      `${CONFIGURED_BACKEND_API}/api/speech/transcribe`,
      `${CONFIGURED_BACKEND_API}/api/voice/stt`,
    );
  }

  // In production this same-origin route proxies to RENDER_BACKEND_URL and
  // keeps the backend URL/token out of the browser. It also avoids CORS.
  endpoints.push(
    "/api/backend/api/speech/transcribe",
    "/api/backend/api/voice/stt",
  );

  // Keep the bundled local Faster-Whisper service convenient during Vite dev.
  if (import.meta.env.DEV && CONFIGURED_BACKEND_API !== LOCAL_BACKEND_API) {
    endpoints.push(
      `${LOCAL_BACKEND_API}/api/speech/transcribe`,
      `${LOCAL_BACKEND_API}/api/voice/stt`,
    );
  }

  return [...new Set(endpoints)];
}

async function responseError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body) return response.statusText || "Unknown error";

  try {
    const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
    const detail = parsed.detail ?? parsed.error;
    return typeof detail === "string" ? detail : body;
  } catch {
    return body;
  }
}

async function tryTranscribeEndpoint(
  url: string,
  audioBlob: Blob,
  controller: AbortController,
): Promise<RawTranscription | null> {
  const formData = new FormData();
  const fileName = audioFileName(audioBlob.type);
  formData.append("audio", audioBlob, fileName);

  console.log("[whisper] sending audio", {
    url,
    fileName,
    size: audioBlob.size,
    type: audioBlob.type,
  });

  const response = await fetch(url, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: formData,
    signal: controller.signal,
  });

  console.log(`[whisper] ${url} -> status ${response.status}`);

  if (!response.ok) {
    const errorBody = await responseError(response);
    console.error(`[whisper] ${url} HTTP error`, response.status, errorBody);
    throw new TranscriptionHttpError(
      response.status,
      `Whisper request failed (${response.status}): ${errorBody}`,
    );
  }

  let data: RawTranscription;
  try {
    data = (await response.json()) as RawTranscription;
  } catch (error) {
    console.error(`[whisper] ${url} returned invalid JSON`, error);
    throw new Error("Whisper returned an invalid response");
  }
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

  const endpoints = transcriptionEndpoints();

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
        // These statuses mean the server received this audio and rejected the
        // payload itself. Retrying a duplicate route only wastes model time.
        if (
          err instanceof TranscriptionHttpError &&
          [400, 413, 415, 422].includes(err.status)
        ) {
          throw err;
        }
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
  const healthEndpoints = CONFIGURED_BACKEND_API
    ? [`${CONFIGURED_BACKEND_API}/api/health`, "/api/backend/api/health"]
    : ["/api/backend/api/health", ...(import.meta.env.DEV ? [`${LOCAL_BACKEND_API}/api/health`] : [])];

  for (const url of healthEndpoints) {
    try {
      const response = await fetch(url, { headers: COMMON_HEADERS });
      if (!response.ok) continue;
      const data = (await response.json()) as { status: string };
      if (data.status === "ok") return true;
    } catch {
      // Try the next configured backend.
    }
  }
  return false;
}
