import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, Brain, Loader2, Plus, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { authenticatedFetch } from "@/lib/api-client";
import { useCrm } from "@/lib/crm-store";

export const Route = createFileRoute("/memory")({ component: MemoryPage });

type MemoryFact = {
  id: string;
  entity_type: string;
  key_phrase: string;
  memory_value: Record<string, unknown>;
  confidence: number;
  source: string;
  expires_at: string | null;
  last_verified_at: string | null;
  correction_note: string | null;
};

type KnowledgeEntry = {
  id: string;
  title: string;
  category: string;
  current_version: number;
  content: Record<string, unknown> | null;
};

function MemoryPage() {
  const { organization } = useCrm();
  const [memory, setMemory] = useState<MemoryFact[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [keyPhrase, setKeyPhrase] = useState("");
  const [value, setValue] = useState("");
  const [entityType, setEntityType] = useState("preference");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organization) return;
    setBusy(true);
    try {
      const query = new URLSearchParams({ organization_id: organization.id });
      const [memoryResponse, knowledgeResponse] = await Promise.all([
        authenticatedFetch(`/api/learning/memory?${query}`),
        authenticatedFetch(`/api/learning/knowledge?${query}`),
      ]);
      if (!memoryResponse.ok || !knowledgeResponse.ok)
        throw new Error("Не удалось загрузить память");
      setMemory(((await memoryResponse.json()) as { memory: MemoryFact[] }).memory ?? []);
      setKnowledge(
        ((await knowledgeResponse.json()) as { knowledge: KnowledgeEntry[] }).knowledge ?? [],
      );
      setError(null);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error ? unknownError.message : "Не удалось загрузить память",
      );
    } finally {
      setBusy(false);
    }
  }, [organization]);

  useEffect(() => void load(), [load]);

  const addFact = async () => {
    if (!organization || !keyPhrase.trim() || !value.trim()) return;
    setBusy(true);
    try {
      const response = await authenticatedFetch("/api/learning/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: organization.id,
          entity_type: entityType,
          key_phrase: keyPhrase,
          memory_value: { fact: value },
          confidence: 1,
        }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить факт");
      setKeyPhrase("");
      setValue("");
      await load();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Не удалось сохранить факт");
    } finally {
      setBusy(false);
    }
  };

  const correctFact = async (fact: MemoryFact) => {
    if (!organization) return;
    const corrected = window.prompt(
      "Исправленное значение факта",
      String(fact.memory_value["fact"] ?? ""),
    );
    if (corrected === null || !corrected.trim()) return;
    const note = window.prompt("Причина исправления");
    if (!note?.trim()) return;
    setBusy(true);
    try {
      const response = await authenticatedFetch(`/api/learning/memory/${fact.id}/correct`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: organization.id,
          memory_value: { fact: corrected.trim() },
          correction_note: note.trim(),
          confidence: 1,
        }),
      });
      if (!response.ok) throw new Error("Не удалось исправить факт");
      await load();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Не удалось исправить факт");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell title="Память и знания" subtitle="Подтверждённые факты и версионная база знаний">
      <div className="space-y-5">
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <section className="panel p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold">
              <Brain className="size-4 text-primary" /> Память пользователя
            </h2>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-border p-2 text-muted-foreground"
            >
              <RefreshCw className="size-4" />
            </button>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-[10rem_1fr_1fr_auto]">
            <select
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
            >
              {[
                "preference",
                "client",
                "company",
                "project",
                "task",
                "contact",
                "synonym",
                "outcome",
              ].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
            <input
              value={keyPhrase}
              onChange={(event) => setKeyPhrase(event.target.value)}
              placeholder="Ключ или тема"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
            />
            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Подтверждённый факт"
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy || !keyPhrase.trim() || !value.trim()}
              onClick={() => void addFact()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}{" "}
              Добавить
            </button>
          </div>
          <div className="mt-4 grid gap-2">
            {memory.map((fact) => (
              <button
                key={fact.id}
                type="button"
                onClick={() => void correctFact(fact)}
                className="rounded-xl border border-border p-3 text-left transition hover:border-primary/40"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{fact.key_phrase}</span>
                  <span className="text-xs text-muted-foreground">
                    {fact.entity_type} · source: {fact.source} · confidence:{" "}
                    {Number(fact.confidence).toFixed(2)}
                  </span>
                </div>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-muted-foreground">
                  {JSON.stringify(fact.memory_value)}
                </pre>
                {fact.correction_note && (
                  <p className="mt-1 text-xs text-primary">
                    Последнее исправление: {fact.correction_note}
                  </p>
                )}
              </button>
            ))}
            {!busy && memory.length === 0 && (
              <p className="text-sm text-muted-foreground">Подтверждённых фактов пока нет.</p>
            )}
          </div>
        </section>

        <section className="panel p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <BookOpen className="size-4 text-primary" /> База знаний компании
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {knowledge.map((entry) => (
              <article key={entry.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">{entry.title}</h3>
                  <span className="text-xs text-muted-foreground">v{entry.current_version}</span>
                </div>
                <p className="text-xs text-muted-foreground">{entry.category}</p>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
                  {JSON.stringify(entry.content, null, 2)}
                </pre>
              </article>
            ))}
            {!busy && knowledge.length === 0 && (
              <p className="text-sm text-muted-foreground">База знаний пока пуста.</p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
