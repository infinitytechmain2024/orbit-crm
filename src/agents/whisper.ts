import type { TranscriptionResult } from "../types/voice";

const TRANSCRIPTION_ENDPOINT = "/api/backend/api/speech/transcribe";
const HEALTH_ENDPOINT = "/api/backend/api/health";

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
  // The first local request may also download/load the configured model.
  timeoutMs = 120000,
): Promise<TranscriptionResult> {
  console.log("[whisper] transcribe start", {
    size: audioBlob.size,
    type: audioBlob.type,
  });

  if (audioBlob.size === 0) {
    throw new Error("Cannot transcribe: audio blob is empty");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const data = await tryTranscribeEndpoint(TRANSCRIPTION_ENDPOINT, audioBlob, controller);
    const text = (data?.text ?? data?.transcript ?? "").trim();
    if (!text) throw new Error("Whisper returned an empty transcript");

    return { text, language: data?.language };
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    console.error("[whisper] request timed out after", timeoutMs, "ms");
    throw new Error("Transcription timed out — the model may be starting up");
  } finally {
    clearTimeout(timer);
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
