import { createFileRoute } from "@tanstack/react-router";

interface TaskProposal {
  title: string;
  description: string;
  priority: "high" | "med" | "low";
  assignee: string;
  checklist: string[];
  target_role: string | null;
  dispatch_to_workflow: boolean;
  project_hint: string | null;
}

// Workflow-aware target roles (must align with ai_agents.role values)
const TARGET_ROLES = [
  "CEO",
  "Backend",
  "Frontend",
  "QA / DevOps",
  "AI Integrations",
  "CMO",
  "Sales Rep",
  "SEO",
  "SMM",
  "Рассылка",
  "Парсинг",
  "Data Analyst",
  "Рекрутинг",
  "Онбординг",
  "People Ops",
  "COO",
  "Orbit Commander",
] as const;

const SYSTEM_PROMPT = `Ты — диспетчер Orbit CRM + AI Workflow (C-level агент).
Разбери заметку пользователя на атомарные задачи и подготовь их к диспетчеризации через AI Workflow.

Правила:
- Выделяй каждое поручение/идею как отдельную задачу. Не создавай абстрактные "проанализировать заметку".
- Для каждой задачи: краткое название (≤80 симв.), описание что сделать, приоритет, checklist.
- Обязательно оцени target_role — куда C-level агент должен маршрутизировать задачу. Выбери ровно одну роль из списка: ${TARGET_ROLES.join(", ")}. Если явной подсказки нет — поставь "COO".
- dispatch_to_workflow: true если задача требует исполнения/декомпозиции C-level агентом (95% случаев = true). Ставь false только для личных заметок без действия.
- Если в тексте упоминается проект (например, Orbit CRM, OSNOVA, BERRDO) — положи его название в project_hint, иначе null.
- Приоритет: high — срочно/дедлайн/бизнес-критично, med — скоро, low — бэклог.

Отвечай ТОЛЬКО валидным JSON. Никакого текста до/после.`;

// Structured output — совместимо как с array, так и с {"tasks": [...]} оболочкой
const JSON_SCHEMA_HINT = `
Формат ответа — JSON объект:
{
  "tasks": [
    {
      "title": "Краткое название задачи",
      "description": "Подробное описание что сделать",
      "priority": "high|med|low",
      "assignee": "Имя исполнителя или пустая строка",
      "checklist": ["Шаг 1", "Шаг 2"],
      "target_role": "одна из: ${TARGET_ROLES.join(" | ")}",
      "dispatch_to_workflow": true,
      "project_hint": "название проекта или null"
    }
  ]
}
Допускается также прямой JSON-массив задач в том же формате.
dispatch_to_workflow по умолчанию true.
`;

type ProviderConfig = {
  name: string;
  url: string;
  apiKey: string | undefined;
  model: string;
};

function getProviders(): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  // NVIDIA NIM (primary) — llama-3.3 EOL 2026-08-26, replaced with gpt-oss-120b
  if (process.env.NVIDIA_API_KEY) {
    providers.push({
      name: "nvidia",
      url: "https://integrate.api.nvidia.com/v1/chat/completions",
      apiKey: process.env.NVIDIA_API_KEY,
      model: process.env.NVIDIA_MODEL || "openai/gpt-oss-120b",
    });
  }

  // Groq (fallback — has chat completions, not just Whisper) — llama-3.3 retired 2026-08-16 per Groq deprecation
  if (process.env.GROQ_API_KEY) {
    const baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
    providers.push({
      name: "groq",
      url: `${baseUrl}/chat/completions`,
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`${provider.name}: request timed out after 30s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

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

  return tasks.map((t: Record<string, unknown>) => {
    const rawTarget = String(t.target_role ?? t.targetRole ?? "").trim();
    const normalizedTarget = (TARGET_ROLES as readonly string[]).includes(rawTarget)
      ? rawTarget
      : null;
    const dispatchRaw = t.dispatch_to_workflow ?? t.dispatchToWorkflow;
    return {
      title: String(t.title || "Без названия").slice(0, 200),
      description: String(t.description || ""),
      priority: (["high", "med", "low"].includes(String(t.priority))
        ? t.priority
        : "low") as TaskProposal["priority"],
      assignee: String(t.assignee || ""),
      checklist: Array.isArray(t.checklist) ? t.checklist.map(String).slice(0, 10) : [],
      target_role: normalizedTarget ?? (dispatchRaw === false ? null : "COO"),
      dispatch_to_workflow: dispatchRaw === false ? false : true,
      project_hint: t.project_hint ? String(t.project_hint).slice(0, 80) : null,
    } satisfies TaskProposal;
  });
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
