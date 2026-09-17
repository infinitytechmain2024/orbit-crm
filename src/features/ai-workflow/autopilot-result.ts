/**
 * Parsers for the autopilot lifecycle data stored on `ai_tasks.result`.
 *
 * That column is untyped JSON written by the backend, and rows predating the
 * autopilot lifecycle carry none of these fields — so every accessor here is
 * defensive. An exception during parsing would take the whole task dialog down.
 *
 * They live outside the component file so the component module exports only a
 * component (React Fast Refresh requires that).
 */

export type PlanStep = {
  id: string;
  title: string;
  status: string;
  note?: string;
  detail?: string;
};

export type Finding = {
  severity: string;
  file?: string;
  summary: string;
  suggestion?: string;
};

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asPlanSteps(value: unknown): PlanStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const title = asString(record["title"]);
    if (!title) return [];
    return [
      {
        id: asString(record["id"]) || "?",
        title,
        // A step with no status reads as pending: never as done.
        status: asString(record["status"]) || "pending",
        note: asString(record["note"]),
        detail: asString(record["detail"]),
      },
    ];
  });
}

export function asFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const summary = asString(record?.["summary"]);
    if (!record || !summary) return [];
    return [
      {
        severity: asString(record["severity"]) || "minor",
        file: asString(record["file"]),
        summary,
        suggestion: asString(record["suggestion"]),
      },
    ];
  });
}
