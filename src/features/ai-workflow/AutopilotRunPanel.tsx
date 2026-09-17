import {
  AlertTriangle,
  CircleSlash,
  ExternalLink,
  GitBranch,
  ListChecks,
  MonitorPlay,
} from "lucide-react";

import { cn } from "@/lib/utils";

import { asFindings, asPlanSteps, asRecord, asString } from "./autopilot-result";

/**
 * Renders what an autopilot run actually did.
 *
 * The backend already stored the plan, the self-review findings and the browser
 * test outcome on `ai_tasks.result`, but the dialog only ever showed a summary
 * string and a JSON dump — so the one thing worth looking at (which steps got
 * done, and whether a browser really exercised the change) was invisible.
 *
 * Everything here is defensive: `result` is untyped JSON from the database, and
 * older rows predate these fields entirely.
 */

const STEP_STYLE: Record<string, { label: string; className: string }> = {
  done: { label: "Сделано", className: "text-badge-green" },
  blocked: { label: "Заблокировано", className: "text-badge-orange" },
  pending: { label: "Не сделано", className: "text-muted-foreground" },
};

const VERIFICATION_STYLE: Record<string, { label: string; className: string }> = {
  passed: { label: "пройден", className: "text-badge-green" },
  failed: { label: "не пройден", className: "text-destructive" },
  error: { label: "не удалось выполнить", className: "text-badge-orange" },
  skipped: { label: "пропущен", className: "text-muted-foreground" },
};

const SEVERITY_CLASS: Record<string, string> = {
  blocker: "text-destructive",
  major: "text-badge-orange",
  minor: "text-muted-foreground",
};

export function AutopilotRunPanel({ result }: { result: Record<string, unknown> }) {
  const plan = asRecord(result["plan"]);
  const steps = asPlanSteps(plan?.["steps"]);
  const findings = asFindings(result["review_findings"]);
  const verification = asRecord(result["verification"]);
  const prUrl = asString(result["pr_url"]);
  const branch = asString(result["branch"]);

  // Nothing autopilot-shaped here — let the caller fall back to its own rendering.
  if (!steps.length && !findings.length && !verification && !prUrl) return null;

  const counts = asRecord(plan?.["counts"]);
  const done = Number(counts?.["done"] ?? 0);
  const total = Number(counts?.["total"] ?? steps.length);
  const verificationStatus = asString(verification?.["status"]) || "skipped";
  const verificationStyle = VERIFICATION_STYLE[verificationStatus] ?? {
    label: verificationStatus,
    className: "text-muted-foreground",
  };

  return (
    <section
      data-testid="autopilot-run-panel"
      className="space-y-3 rounded-xl border border-primary/20 bg-primary/[0.035] p-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-xs font-semibold">
          <ListChecks className="size-4 text-primary" /> Ран автопилота
        </h3>
        {branch && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <GitBranch className="size-3" />
            {branch}
          </span>
        )}
        {prUrl && (
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
          >
            <ExternalLink className="size-3" /> Pull Request
          </a>
        )}
      </header>

      {steps.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            План — {done}/{total} выполнено
          </p>
          <ul className="aiwf-plain-list mt-1 space-y-1">
            {steps.map((step) => {
              const style = STEP_STYLE[step.status] ?? STEP_STYLE["pending"]!;
              return (
                <li key={step.id} className="flex gap-2 text-[11px] leading-5">
                  <span className={cn("shrink-0 font-medium", style.className)}>{style.label}</span>
                  <span className="text-muted-foreground">
                    {step.id}. {step.title}
                    {step.note && <span className="opacity-70"> — {step.note}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div>
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <MonitorPlay className="size-3" /> Браузерный самотест
        </p>
        <p className="mt-1 text-[11px] leading-5">
          <span className={cn("font-medium", verificationStyle.className)}>
            {verificationStyle.label}
          </span>
          <span className="text-muted-foreground">
            {" "}
            — {asString(verification?.["reason"]) || "—"}
          </span>
        </p>
        {asString(verification?.["spec"]) && (
          <p className="text-[10px] text-muted-foreground opacity-70">
            Сценарий: {asString(verification?.["spec"])}
          </p>
        )}
      </div>

      <div>
        <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {findings.length ? (
            <AlertTriangle className="size-3" />
          ) : (
            <CircleSlash className="size-3" />
          )}
          Самопроверка кода
        </p>
        {findings.length === 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">Незакрытых замечаний нет.</p>
        ) : (
          <ul className="aiwf-plain-list mt-1 space-y-1">
            {findings.map((finding, index) => (
              <li key={`${finding.file}-${index}`} className="text-[11px] leading-5">
                <span className={cn("font-medium", SEVERITY_CLASS[finding.severity] ?? "")}>
                  {finding.severity}
                </span>
                {finding.file && <span className="text-muted-foreground"> ({finding.file})</span>}
                <span className="text-muted-foreground"> {finding.summary}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
