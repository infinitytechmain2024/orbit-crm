import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { authenticatedFetch } from "@/lib/api-client";
import { useCrm } from "@/lib/crm-store";

export const Route = createFileRoute("/self-development")({
  component: ControlledImprovementPage,
});

type Proposal = {
  id: string;
  target_type: "knowledge" | "template" | "business_process";
  title: string;
  rationale: string;
  evidence: unknown[];
  risk_level: "low" | "medium" | "high" | "critical";
  confidence: number | null;
  status: "pending_review" | "approved" | "rejected" | "applied" | "rolled_back";
  proposal_version: number;
  review_note: string | null;
};
type Pattern = {
  pattern_key: string;
  action_type: string;
  outcome: string;
  occurrences: number;
  client_count: number;
  average_score: number | null;
  explanation: string;
  evidence_outcome_ids: string[];
};

const riskStyle = {
  low: "bg-emerald-500/10 text-emerald-600",
  medium: "bg-amber-500/10 text-amber-600",
  high: "bg-orange-500/10 text-orange-600",
  critical: "bg-destructive/10 text-destructive",
};

function ControlledImprovementPage() {
  const { organization } = useCrm();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [status, setStatus] = useState("pending_review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organization) return;
    setBusy(true);
    try {
      const proposalsQuery = new URLSearchParams({ organization_id: organization.id, status });
      const patternsQuery = new URLSearchParams({
        organization_id: organization.id,
        min_occurrences: "3",
      });
      const [proposalResponse, patternResponse] = await Promise.all([
        authenticatedFetch(`/api/learning/proposals?${proposalsQuery}`),
        authenticatedFetch(`/api/learning/patterns?${patternsQuery}`),
      ]);
      if (!proposalResponse.ok || !patternResponse.ok)
        throw new Error("Не удалось загрузить данные");
      setProposals(((await proposalResponse.json()) as { proposals: Proposal[] }).proposals ?? []);
      setPatterns(((await patternResponse.json()) as { patterns: Pattern[] }).patterns ?? []);
      setError(null);
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
    }
  }, [organization, status]);

  useEffect(() => void load(), [load]);

  const decide = async (proposal: Proposal, action: "approve" | "reject" | "rollback") => {
    const reason = window.prompt("Укажите основание решения");
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      const response = await authenticatedFetch(
        `/api/learning/proposals/${proposal.id}/${action}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? "Решение не применено");
      }
      await load();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : "Решение не применено");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Контролируемое развитие"
      subtitle="AI предлагает изменения; решение и применение остаются за человеком"
    >
      <div className="space-y-5">
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex gap-3">
            <ShieldCheck className="size-5 shrink-0 text-primary" />
            <div>
              <h2 className="font-semibold">Без автономного изменения production</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                OpenClaw фиксирует результаты и создаёт предложения. Код, роли, финансовые условия и
                правила не меняются без отдельного решения человека.
              </p>
            </div>
          </div>
        </section>
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <section className="panel p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-semibold">
              <BarChart3 className="size-4 text-primary" />
              Повторяющиеся сценарии
            </h2>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-border p-2"
              aria-label="Обновить"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {patterns.map((pattern) => (
              <article key={pattern.pattern_key} className="rounded-xl border border-border p-3">
                <div className="flex justify-between gap-2">
                  <h3 className="font-medium">{pattern.action_type}</h3>
                  <span className="rounded-full bg-muted px-2 py-1 text-xs">
                    {pattern.outcome} × {pattern.occurrences}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{pattern.explanation}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Клиентов: {pattern.client_count} · Оценка: {pattern.average_score ?? "нет"} ·
                  Доказательств: {pattern.evidence_outcome_ids.length}
                </p>
              </article>
            ))}
            {!busy && patterns.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Нужно минимум три результата одного типа.
              </p>
            )}
          </div>
        </section>
        <section className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Очередь согласования</h2>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
            >
              <option value="pending_review">Ожидают решения</option>
              <option value="applied">Применены</option>
              <option value="approved">Одобрены вручную</option>
              <option value="rejected">Отклонены</option>
              <option value="rolled_back">Откачены</option>
            </select>
          </div>
          <div className="mt-4 grid gap-3">
            {proposals.map((proposal) => (
              <article key={proposal.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{proposal.title}</h3>
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${riskStyle[proposal.risk_level]}`}
                  >
                    риск: {proposal.risk_level}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {proposal.target_type} · v{proposal.proposal_version}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{proposal.rationale}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Уверенность: {proposal.confidence ?? "нет"} · доказательств:{" "}
                  {proposal.evidence.length}
                </p>
                {proposal.review_note && (
                  <p className="mt-2 text-xs text-primary">
                    Решение человека: {proposal.review_note}
                  </p>
                )}
                {proposal.status === "pending_review" && (
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(proposal, "approve")}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    >
                      <CheckCircle2 className="size-4" />
                      Подтвердить
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decide(proposal, "reject")}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                    >
                      <XCircle className="size-4" />
                      Отклонить
                    </button>
                  </div>
                )}
                {proposal.status === "applied" && proposal.target_type === "knowledge" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decide(proposal, "rollback")}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <RotateCcw className="size-4" />
                    Создать версию отката
                  </button>
                )}
              </article>
            ))}
            {!busy && proposals.length === 0 && (
              <p className="text-sm text-muted-foreground">В этой очереди предложений нет.</p>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
