import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useRef } from "react";
import { Sparkles, Copy, Check, Plus, Trash2, Wand2, ChevronDown, ChevronUp } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/prompt-generator")({
  head: () => ({
    meta: [
      { title: "Генератор промптов — Orbit CRM" },
      {
        name: "description",
        content: "Быстрое создание структурированных промптов для ИИ-задач.",
      },
      { property: "og:title", content: "Генератор промптов — Orbit CRM" },
      {
        property: "og:description",
        content: "Генератор промптов для ИИ-задач с шаблонами и копированием.",
      },
    ],
  }),
  component: PromptGeneratorPage,
});

type Priority = "critical" | "high" | "medium" | "low";

interface Step {
  id: string;
  text: string;
}

interface PromptForm {
  title: string;
  description: string;
  expectedResult: string;
  priority: Priority;
  steps: Step[];
  constraints: string;
  context: string;
  outputFormat: string;
}

const PRIORITY_OPTIONS: { value: Priority; label: string; color: string }[] = [
  {
    value: "critical",
    label: "Критический",
    color: "bg-red-500/15 text-red-400 border-red-500/30",
  },
  {
    value: "high",
    label: "Высокий",
    color: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  },
  {
    value: "medium",
    label: "Средний",
    color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  },
  { value: "low", label: "Низкий", color: "bg-green-500/15 text-green-400 border-green-500/30" },
];

const DEFAULT_FORM: PromptForm = {
  title: "",
  description: "",
  expectedResult: "",
  priority: "medium",
  steps: [{ id: crypto.randomUUID(), text: "" }],
  constraints: "",
  context: "",
  outputFormat: "",
};

function generatePrompt(form: PromptForm): string {
  const lines: string[] = [];

  lines.push(`# Задача: ${form.title || "Без названия"}`);
  lines.push("");

  if (form.context) {
    lines.push("## Контекст");
    lines.push(form.context);
    lines.push("");
  }

  lines.push("## Описание");
  lines.push(form.description || "Описание не указано.");
  lines.push("");

  if (form.steps.length > 0 && form.steps.some((s) => s.text.trim())) {
    lines.push("## Шаги выполнения");
    form.steps
      .filter((s) => s.text.trim())
      .forEach((step, i) => {
        lines.push(`${i + 1}. ${step.text}`);
      });
    lines.push("");
  }

  lines.push("## Ожидаемый результат");
  lines.push(form.expectedResult || "Результат не указан.");
  lines.push("");

  if (form.constraints) {
    lines.push("## Ограничения");
    lines.push(form.constraints);
    lines.push("");
  }

  if (form.outputFormat) {
    lines.push("## Формат вывода");
    lines.push(form.outputFormat);
    lines.push("");
  }

  const prioLabel = PRIORITY_OPTIONS.find((p) => p.value === form.priority)?.label ?? form.priority;
  lines.push("---");
  lines.push(`Приоритет: ${prioLabel}`);

  return lines.join("\n");
}

function PromptGeneratorPage() {
  const [form, setForm] = useState<PromptForm>(DEFAULT_FORM);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const copyTimer = useRef<number | undefined>(undefined);
  const previewRef = useRef<HTMLPreElement>(null);

  const prompt = generatePrompt(form);

  const updateField = useCallback(<K extends keyof PromptForm>(key: K, value: PromptForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const addStep = useCallback(() => {
    setForm((prev) => ({
      ...prev,
      steps: [...prev.steps, { id: crypto.randomUUID(), text: "" }],
    }));
  }, []);

  const removeStep = useCallback((id: string) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.filter((s) => s.id !== id),
    }));
  }, []);

  const updateStep = useCallback((id: string, text: string) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((s) => (s.id === id ? { ...s, text } : s)),
    }));
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = prompt;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [prompt]);

  const handleReset = useCallback(() => {
    setForm(DEFAULT_FORM);
  }, []);

  return (
    <AppShell
      title="Генератор промптов"
      subtitle="Быстрое создание структурированных промптов для ИИ-задач"
    >
      <div className="grid gap-6 xl:grid-cols-2">
        {/* Left: Form */}
        <div className="space-y-5">
          <section className="panel p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="size-4 text-primary" />
              Основная информация
            </h3>

            <div className="space-y-4">
              <Field label="Название задачи">
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  placeholder="Напр.: Реализовать форму регистрации"
                  className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </Field>

              <Field label="Описание проблемы">
                <textarea
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  placeholder="Подробно опишите задачу, её контекст и что нужно сделать..."
                  rows={4}
                  className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                />
              </Field>

              <Field label="Контекст (опционально)">
                <textarea
                  value={form.context}
                  onChange={(e) => updateField("context", e.target.value)}
                  placeholder="Дополнительная информация: используемые технологии, особенности проекта, ссылки..."
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                />
              </Field>

              <Field label="Ожидаемый результат">
                <textarea
                  value={form.expectedResult}
                  onChange={(e) => updateField("expectedResult", e.target.value)}
                  placeholder="Что должно получиться на выходе..."
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                />
              </Field>
            </div>
          </section>

          <section className="panel p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Wand2 className="size-4 text-primary" />
              Детали выполнения
            </h3>

            <div className="space-y-4">
              <Field label="Приоритет">
                <div className="flex flex-wrap gap-2">
                  {PRIORITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateField("priority", opt.value)}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                        form.priority === opt.value
                          ? opt.color
                          : "border-border bg-surface-2/40 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Шаги выполнения">
                <div className="space-y-2">
                  {form.steps.map((step, index) => (
                    <div key={step.id} className="flex items-center gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                        {index + 1}
                      </span>
                      <input
                        type="text"
                        value={step.text}
                        onChange={(e) => updateStep(step.id, e.target.value)}
                        placeholder={`Шаг ${index + 1}...`}
                        className="flex-1 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      />
                      {form.steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeStep(step.id)}
                          className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={addStep}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                  >
                    <Plus className="size-3.5" />
                    Добавить шаг
                  </button>
                </div>
              </Field>

              <Field label="Ограничения (опционально)">
                <textarea
                  value={form.constraints}
                  onChange={(e) => updateField("constraints", e.target.value)}
                  placeholder="Чего нельзя делать, рамки, сроки..."
                  rows={2}
                  className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
                />
              </Field>

              <Field label="Формат вывода (опционально)">
                <input
                  type="text"
                  value={form.outputFormat}
                  onChange={(e) => updateField("outputFormat", e.target.value)}
                  placeholder="Напр.: JSON, Markdown-таблица, код на Python..."
                  className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
              </Field>
            </div>
          </section>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition",
                copied
                  ? "bg-green-500/15 text-green-400 border border-green-500/30"
                  : "bg-primary text-primary-foreground hover:opacity-90",
              )}
            >
              {copied ? (
                <>
                  <Check className="size-4" />
                  Скопировано!
                </>
              ) : (
                <>
                  <Copy className="size-4" />
                  Копировать промпт
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-xl border border-border bg-surface-2/60 px-4 py-3 text-sm text-muted-foreground transition hover:text-foreground"
            >
              Сбросить
            </button>
          </div>
        </div>

        {/* Right: Live Preview */}
        <div className="xl:sticky xl:top-24 xl:self-start">
          <section className="panel overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-foreground transition hover:bg-surface-2/40"
            >
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-green-400 animate-pulse" />
                Предпросмотр промпта
              </span>
              {showPreview ? (
                <ChevronUp className="size-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" />
              )}
            </button>
            {showPreview && (
              <div className="border-t border-border">
                <pre
                  ref={previewRef}
                  className="max-h-[600px] overflow-auto p-5 font-mono text-[13px] leading-relaxed text-foreground/90 whitespace-pre-wrap"
                >
                  {prompt}
                </pre>
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
