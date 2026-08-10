import type { TranscriptionResult } from "../types/voice";

const BACKEND_API = import.meta.env.VITE_API_URL || "http://localhost:8000";

const COMMON_HEADERS = {
  "ngrok-skip-browser-warning": "true",
};

export async function transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  const response = await fetch(`${BACKEND_API}/api/voice/stt`, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(`Transcription failed (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    transcript: string;
    language?: string;
    duration?: number;
  };

  return {
    text: data.transcript,
    language: data.language ?? undefined,
  } as TranscriptionResult;
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
