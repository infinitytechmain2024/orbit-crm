import { createFileRoute } from "@tanstack/react-router";

interface TaskProposal {
  title: string;
  description: string;
  priority: "high" | "med" | "low";
  assignee: string;
  checklist: string[];
}

const SYSTEM_PROMPT = `Ты — ИИ-ассистент для управления задачами Orbit CRM. Твоя задача — проанализировать текстовую заметку пользователя и разбить её на конкретные, выполнимые задачи.

Правила:
- Выделяй каждое отдельное поручение, идею, подзадачу или действие как отдельную задачу.
- Не создавай абстрактные задачи вроде "проанализировать заметку" — только конкретные действия.
- Для каждой задачи укажи: краткое название (одной строкой), подробное описание, приоритет (high/med/low), исполнителя (если упоминается имя), шаги выполнения (чек-лист, если уместно).
- Если в тексте упоминаются проекты или другие задачи — упомяни это в описании.
- Если действие одно — верни одну задачу. Если несколько — верни несколько.
- Приоритет: high — срочно/важно/дедлайн, med — нужно сделать скоро, low — когда-нибудь/не срочно.

Отвечай ТОЛЬКО валидным JSON массивом объектов. Никакого текста до или после JSON.`;

const JSON_SCHEMA_HINT = `
Формат ответа — JSON массив:
[
  {
    "title": "Краткое название задачи",
    "description": "Подробное описание что сделать",
    "priority": "high|med|low",
    "assignee": "Имя исполнителя или пустая строка",
    "checklist": ["Шаг 1", "Шаг 2"]
  }
]`;

type ProviderConfig = {
  name: string;
  url: string;
  apiKey: string | undefined;
  model: string;
};

function getProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  // NVIDIA NIM (primary)
  if (process.env.NVIDIA_API_KEY) {
    providers.push({
      name: "nvidia",
      url: "https://integrate.api.nvidia.com/v1/chat/completions",
      apiKey: process.env.NVIDIA_API_KEY,
      model: process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct",
    });
  }

  // Groq (fallback — has chat completions, not just Whisper)
  if (process.env.GROQ_API_KEY) {
    const baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
    providers.push({
      name: "groq",
      url: `${baseUrl}/chat/completions`,
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    });
  }

  // OpenAI (last fallback)
  if (process.env.OPENAI_API_KEY) {
    const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    providers.push({
      name: "openai",
      url: `${baseUrl}/chat/completions`,
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    });
  }

  return providers;
}

async function callProvider(provider: ProviderConfig, userText: string): Promise<TaskProposal[]> {
  const body = {
    model: provider.model,
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT + "\n" + JSON_SCHEMA_HINT },
      {
        role: "user" as const,
        content: `Проанализируй эту заметку и разбей на задачи:\n\n"""${userText}"""`,
      },
    ],
    temperature: 0.15,
    ...(provider.name !== "nvidia" ? { response_format: { type: "json_object" as const } } : {}),
  };

  console.log(`[analyze-tasks] Calling ${provider.name} (${provider.model})`);

  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`${provider.name} returned ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${provider.name}: empty response`);

  // Parse JSON — strip markdown fences if present
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  const parsed = JSON.parse(cleaned);
  const tasks = Array.isArray(parsed) ? parsed : parsed.tasks || parsed.items || [parsed];

  return tasks.map((t: Record<string, unknown>) => ({
    title: String(t.title || "Без названия").slice(0, 200),
    description: String(t.description || ""),
    priority: (["high", "med", "low"].includes(String(t.priority))
      ? t.priority
      : "low") as TaskProposal["priority"],
    assignee: String(t.assignee || ""),
    checklist: Array.isArray(t.checklist) ? t.checklist.map(String).slice(0, 10) : [],
  }));
}

export const Route = createFileRoute("/api/ai/analyze-tasks")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const text = String(body.text || "").trim();
        if (!text) {
          return Response.json({ error: "Missing 'text' field" }, { status: 400 });
        }

        const providers = getProviders();
        if (providers.length === 0) {
          return Response.json(
            {
              error:
                "No AI providers configured. Set NVIDIA_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY.",
            },
            { status: 500 },
          );
        }

        // Cascade: try each provider in order
        const errors: string[] = [];
        for (const provider of providers) {
          try {
            const tasks = await callProvider(provider, text);
            console.log(`[analyze-tasks] ${provider.name} returned ${tasks.length} tasks`);
            return Response.json({
              tasks,
              provider: provider.name,
              model: provider.model,
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[analyze-tasks] ${provider.name} failed:`, msg);
            errors.push(`${provider.name}: ${msg}`);
          }
        }

        return Response.json(
          { error: `All AI providers failed:\n${errors.join("\n")}` },
          { status: 502 },
        );
      },
    },
  },
});
