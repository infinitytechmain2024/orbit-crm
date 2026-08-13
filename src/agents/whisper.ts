import type { TranscriptionResult } from "../types/voice";
import { supabase } from "../lib/supabase/client";

const TRANSCRIPTION_ENDPOINT = "/api/speech/transcribe";
const HEALTH_ENDPOINT = TRANSCRIPTION_ENDPOINT;

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
  signal?: AbortSignal,
): Promise<RawTranscription> {
  const formData = new FormData();
  const fileName = audioFileName(audioBlob.type);
  formData.append("audio", audioBlob, fileName);

  const headers = new Headers(COMMON_HEADERS);
  const { data: sessionData } = (await supabase?.auth.getSession()) ?? {
    data: { session: null },
  };
  if (sessionData.session?.access_token) {
    headers.set("authorization", `Bearer ${sessionData.session.access_token}`);
  }

  console.log("[whisper] sending audio", {
    url,
    fileName,
    size: audioBlob.size,
    type: audioBlob.type,
  });

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: formData,
    signal: signal ?? null,
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
  timeoutMs = 60_000,
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
    const data = await tryTranscribeEndpoint(TRANSCRIPTION_ENDPOINT, audioBlob, controller.signal);
    const text = (data.text ?? data.transcript ?? "").trim();
    if (!text) throw new Error("Whisper returned an empty transcript");
    return data.language ? { text, language: data.language } : { text };
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    console.error("[whisper] request timed out after", timeoutMs, "ms");
    throw new Error("Transcription timed out. Please try again.");
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
