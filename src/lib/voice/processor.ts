import { getMemoryForIntent } from "./memory";

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

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8000";

const SYSTEM_PROMPT = `Ты — ИИ-ассистент Orbit CRM. Твоя задача — анализировать голосовые команды пользователя и классифицировать их намерения (Intent).

Возможные намерения:
1. CREATE_TASK — пользователь хочет создать задачу. Примеры: "Создай задачу позвонить клиенту", "Добавь задачу в проект Редизайн: подготовить макеты", "Задача: звонок Анне по договору".
2. ESTIMATE_PROJECT — пользователь хочет рассчитать смету для нового проекта. Примеры: "Рассчитай смету для нового проекта CRM", "Сделай оценку по проекту сайт для клиента".
3. WEB_SEARCH_LEADS — пользователь хочет найти контакты/лиды. Примеры: "Найди контакты компании Яндекс", "Поищи лидов в сфере финтех".
4. UNKNOWN — намерение не распознано.

Также извлеки сущности (entities):
- projectName: название проекта (если упоминается)
- taskTitle: название задачи (для CREATE_TASK)
- projectDescription: описание проекта (для ESTIMATE_PROJECT)
- companyName: название компании (для WEB_SEARCH_LEADS)

Верни результат ТОЛЬКО в формате JSON:
{
  "type": "CREATE_TASK|ESTIMATE_PROJECT|WEB_SEARCH_LEADS|UNKNOWN",
  "entities": {
    "projectName": "...",
    "taskTitle": "...",
    "projectDescription": "...",
    "companyName": "..."
  },
  "rawText": "...",
  "confidence": 0.95
}`;

async function tryBackendTranscribe(audioBlob: Blob): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    const response = await fetch(`${BACKEND_URL}/api/voice/transcribe`, {
      method: "POST",
      body: formData,
    });
    if (response.ok) {
      const data = await response.json();
      return data.transcript || null;
    }
  } catch {
    // Backend unavailable, fall through to OpenAI
  }
  return null;
}

async function tryBackendProcess(audioBlob: Blob): Promise<VoiceProcessResult | null> {
  try {
    const formData = new FormData();
    formData.append("audio", audioBlob, "audio.webm");
    const response = await fetch(`${BACKEND_URL}/api/voice/process`, {
      method: "POST",
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

  // Fallback to OpenAI Whisper API
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.webm");
  formData.append("model", "whisper-1");
  formData.append("language", "ru");

  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("No transcription available: backend offline and OpenAI key not configured");
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Transcription failed: ${error}`);
  }

  const data = await response.json();
  return data.text || "";
}

export async function classifyIntent(transcript: string, userId?: string): Promise<VoiceIntent> {
  let memoryContext = "";
  if (userId) {
    const memory = await getMemoryForIntent(userId, transcript);
    if (Object.keys(memory).length > 0) {
      memoryContext = `\n\nКонтекст памяти пользователя (используй для улучшения распознавания):\n${JSON.stringify(memory, null, 2)}`;
    }
  }

  // Try Ollama via backend first
  try {
    const response = await fetch(`${BACKEND_URL}/api/voice/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript, memory_context: memoryContext }),
    });
    // Backend doesn't have a classify-only endpoint yet, so fall through
  } catch {
    // Backend unavailable
  }

  // Fallback to OpenAI
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey) {
    // Return a basic UNKNOWN intent if no API key
    return {
      type: "UNKNOWN",
      entities: {},
      rawText: transcript,
      confidence: 0.1,
    };
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT + memoryContext },
        { role: "user", content: transcript },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Intent classification failed: ${error}`);
  }

  const data = await response.json();
  const intent = JSON.parse(data.choices[0].message.content);
  return intent;
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
  const intent = await classifyIntent(transcript, userId);
  const suggestedActions = await generateSuggestions(intent);

  return { transcript, intent, suggestedActions };
}
