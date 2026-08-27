export interface VoiceIntent {
  type: "CREATE_TASK" | "ESTIMATE_PROJECT" | "WEB_SEARCH_LEADS" | "UNKNOWN";
  entities: {
    projectName?: string;
    taskTitle?: string;
    projectDescription?: string;
    companyName?: string;
  };
  rawText: string;
  confidence: number;
}

export interface VoiceProcessResult {
  transcript: string;
  intent: VoiceIntent;
  suggestedActions: string[];
}

const BACKEND_URL =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_BACKEND_URL ||
  import.meta.env.VITE_LEAD_GEN_URL ||
  "https://orbit-crm-backend.onrender.com";

const COMMON_HEADERS: Record<string, string> = {
  "ngrok-skip-browser-warning": "true",
};

async function tryBackendTranscribe(audioBlob: Blob): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    const response = await fetch(`${BACKEND_URL}/api/speech/transcribe`, {
      method: "POST",
      headers: COMMON_HEADERS,
      body: formData,
    });
    if (response.ok) {
      const data = await response.json();
      return data.success ? data.text || null : null;
    }
  } catch {
    // Backend unavailable.
  }
  return null;
}

async function tryBackendProcess(audioBlob: Blob): Promise<VoiceProcessResult | null> {
  try {
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    const response = await fetch(`${BACKEND_URL}/api/voice/process`, {
      method: "POST",
      headers: COMMON_HEADERS,
      body: formData,
    });
    if (response.ok) {
      const data = await response.json();
      return {
        transcript: data.transcript,
        intent: data.intent as VoiceIntent,
        suggestedActions: data.suggested_actions,
      };
    }
  } catch {
    // Backend unavailable, fall through to OpenAI
  }
  return null;
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  // Try local backend (Faster-Whisper) first
  const backendResult = await tryBackendTranscribe(audioBlob);
  if (backendResult !== null) return backendResult;

  throw new Error("Транскрибация временно недоступна: backend не отвечает");
}

export async function classifyIntent(transcript: string): Promise<VoiceIntent> {
  // Try Ollama via backend first
  try {
    const response = await fetch(`${BACKEND_URL}/api/voice/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...COMMON_HEADERS },
      body: JSON.stringify({ transcript }),
    });
    // Backend doesn't have a classify-only endpoint yet, so fall through
  } catch {
    // Backend unavailable
  }

  // Provider secrets are server-only. Never fall back to a browser-side API key.
  return { type: "UNKNOWN", entities: {}, rawText: transcript, confidence: 0.1 };
}

export async function generateSuggestions(intent: VoiceIntent): Promise<string[]> {
  const suggestions: string[] = [];

  switch (intent.type) {
    case "CREATE_TASK":
      suggestions.push(`Создать задачу "${intent.entities.taskTitle || "Без названия"}"`);
      if (intent.entities.projectName) {
        suggestions.push(`В проекте "${intent.entities.projectName}"`);
      }
      suggestions.push("Приоритет: высокий");
      break;
    case "ESTIMATE_PROJECT":
      suggestions.push(`Создать проект "${intent.entities.projectDescription || "Новый проект"}"`);
      suggestions.push("Рассчитать смету: $10/час + 15% буфер");
      suggestions.push("Определить роли и часы");
      break;
    case "WEB_SEARCH_LEADS":
      suggestions.push(`Найти контакты компании "${intent.entities.companyName || "не указана"}"`);
      suggestions.push("Запустить поиск через OpenManus");
      break;
    default:
      suggestions.push("Не удалось определить намерение");
  }

  return suggestions;
}

export async function processVoiceNote(
  audioBlob: Blob,
  userId?: string,
): Promise<VoiceProcessResult> {
  // Try full backend pipeline first (Faster-Whisper + Ollama)
  const backendResult = await tryBackendProcess(audioBlob);
  if (backendResult !== null) return backendResult;

  // Fallback to OpenAI pipeline
  const transcript = await transcribeAudio(audioBlob);
  const intent = await classifyIntent(transcript);
  const suggestedActions = await generateSuggestions(intent);

  return { transcript, intent, suggestedActions };
}
