import type { TranscriptionResult } from "../types/voice";

const TRANSCRIPTION_ENDPOINT = "/api/backend/api/speech/transcribe";
const HEALTH_ENDPOINT = "/api/backend/api/health";

const COMMON_HEADERS = {
  "ngrok-skip-browser-warning": "true",
};

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2000, 4000, 8000];

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryTranscribeEndpoint(
  url: string,
  audioBlob: Blob,
  signal?: AbortSignal,
): Promise<RawTranscription> {
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
    signal,
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

async function tryOpenAIFallback(
  audioBlob: Blob,
): Promise<RawTranscription> {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured");
  }

  const formData = new FormData();
  formData.append("file", audioBlob, audioFileName(audioBlob.type));
  formData.append("model", "whisper-1");
  formData.append("language", "ru");

  console.log("[whisper] falling back to OpenAI Whisper API");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...COMMON_HEADERS,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    console.error("[whisper] OpenAI fallback failed", response.status, errorBody);
    throw new TranscriptionHttpError(
      response.status,
      `OpenAI fallback failed (${response.status}): ${errorBody}`,
    );
  }

  const data = (await response.json()) as { text?: string };
  return { text: data.text ?? "", language: "ru" };
}

export async function transcribeAudio(
  audioBlob: Blob,
  // Render free plan cold start can take 30-60s; first request needs extra time.
  timeoutMs = 180_000,
): Promise<TranscriptionResult> {
  console.log("[whisper] transcribe start", {
    size: audioBlob.size,
    type: audioBlob.type,
  });

  if (audioBlob.size === 0) {
    throw new Error("Cannot transcribe: audio blob is empty");
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    // Use shorter per-attempt timeout after the first attempt (cold start handled by first attempt)
    const perAttemptTimeout = attempt === 0 ? timeoutMs : 60_000;
    const timer = setTimeout(() => controller.abort(), perAttemptTimeout);

    try {
      console.log(`[whisper] attempt ${attempt + 1}/${MAX_RETRIES + 1}`);
      const data = await tryTranscribeEndpoint(
        TRANSCRIPTION_ENDPOINT,
        audioBlob,
        controller.signal,
      );
      const text = (data?.text ?? data?.transcript ?? "").trim();
      if (!text) throw new Error("Whisper returned an empty transcript");

      return { text, language: data?.language };
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof DOMException && error.name === "AbortError") {
        console.warn(`[whisper] attempt ${attempt + 1} timed out after ${perAttemptTimeout}ms`);
        lastError = new Error("Transcription timed out");
      } else if (error instanceof TranscriptionHttpError && error.status >= 500) {
        console.warn(`[whisper] attempt ${attempt + 1} got server error ${error.status}`);
        lastError = error;
      } else if (error instanceof TranscriptionHttpError && error.status === 422) {
        throw error;
      } else {
        throw error;
      }
    }

    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS_MS[attempt] ?? 8000;
      console.log(`[whisper] retrying in ${delay}ms...`);
      await sleep(delay);
    }
  }

  // All retries exhausted — try OpenAI fallback
  console.warn("[whisper] all backend retries failed, trying OpenAI fallback");
  try {
    const data = await tryOpenAIFallback(audioBlob);
    const text = (data?.text ?? "").trim();
    if (!text) throw new Error("OpenAI returned an empty transcript");
    return { text, language: data?.language };
  } catch (fallbackError) {
    console.error("[whisper] OpenAI fallback also failed", fallbackError);
    throw lastError ?? fallbackError instanceof Error
      ? fallbackError
      : new Error("Transcription failed: backend unavailable and OpenAI fallback failed");
  }
}

export async function checkWhisperHealth(): Promise<boolean> {
  try {
    const response = await fetch(HEALTH_ENDPOINT, { headers: COMMON_HEADERS });
    if (!response.ok) return false;
    const data = (await response.json()) as { status: string };
    return data.status === "ok";
  } catch {
    return false;
  }
}
