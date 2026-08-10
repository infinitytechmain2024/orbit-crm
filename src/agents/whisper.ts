import type { TranscriptionResult } from "../types/voice";

const BACKEND_API = "http://localhost:8000";

export async function transcribeAudio(audioBlob: Blob): Promise<TranscriptionResult> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");
  formData.append("language", "en");

  const response = await fetch(`${BACKEND_API}/api/voice/transcribe`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(`Transcription failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json() as { transcript: string; language?: string };

  return {
    text: data.transcript,
    language: data.language ?? undefined,
  } as TranscriptionResult;
}

export async function processVoiceCommand(
  audioBlob: Blob
): Promise<{
  transcript: string;
  intent: {
    type: string;
    entities: Record<string, unknown>;
    rawText: string;
    confidence: number;
  };
  suggestedActions: string[];
}> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  const response = await fetch(`${BACKEND_API}/api/voice/process`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(`Voice processing failed (${response.status}): ${errorBody}`);
  }

  const data = await response.json() as {
    transcript: string;
    intent: {
      type: string;
      entities: Record<string, unknown>;
      rawText: string;
      confidence: number;
    };
    suggested_actions: string[];
  };

  return {
    transcript: data.transcript,
    intent: data.intent,
    suggestedActions: data.suggested_actions,
  };
}

export async function checkWhisperHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_API}/api/health`);
    if (!response.ok) return false;
    const data = await response.json() as { status: string };
    return data.status === "ok";
  } catch {
    return false;
  }
}
