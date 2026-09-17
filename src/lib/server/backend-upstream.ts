// Backend selection for the Vercel server routes.
//
// The primary backend is the Render service. An optional fallback backend (a
// self-hosted server behind a stable tunnel URL) takes over when the primary
// cannot be reached. Failover never replays a request that the primary may
// already have processed: non-idempotent requests only fail over when the
// connection itself could not be established.

export type BackendRole = "primary" | "fallback";

export type BackendTarget = { role: BackendRole; base: string };

export type BackendRequest = {
  method: string;
  /** Path and query string appended to the backend base URL, e.g. "/api/health?x=1". */
  path: string;
  headers: Headers;
  body?: ArrayBuffer | FormData | string | undefined;
  timeoutMs: number;
  logLabel: string;
};

export type BackendFetchResult =
  | { ok: true; response: Response; role: BackendRole }
  | { ok: false; reason: string; timedOut: boolean };

const DEFAULT_LEGACY_URL_KEYS = ["RENDER_BACKEND_URL", "BACKEND_URL", "AI_WORKFLOW_BACKEND_URL"];

// After the primary fails, send traffic to the fallback first for this long.
// The state is per server instance, so it is a best-effort shortcut, not a guarantee.
const PRIMARY_COOLDOWN_MS = 30_000;
const WAKE_RETRY_DELAY_MS = 2_000;

// Errors raised before a connection exists: the backend never saw the request.
const CONNECT_FAILURE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const UNAVAILABLE_STATUSES = new Set([502, 503, 504]);

let primaryDownUntil = 0;

function envValue(key: string): string {
  return (process.env[key] ?? "").trim().replace(/\/$/, "");
}

export function resolveBackendTargets(
  options: { legacyUrlKeys?: readonly string[]; defaultPrimary?: string } = {},
): BackendTarget[] {
  const legacyUrlKeys = options.legacyUrlKeys ?? DEFAULT_LEGACY_URL_KEYS;
  const primary =
    envValue("BACKEND_PRIMARY_URL") ||
    legacyUrlKeys.map(envValue).find(Boolean) ||
    (options.defaultPrimary ?? "").trim().replace(/\/$/, "") ||
    (process.env["NODE_ENV"] === "development" ? "http://127.0.0.1:8000" : "");
  const fallback = envValue("BACKEND_FALLBACK_URL");

  const targets: BackendTarget[] = [];
  if (primary) targets.push({ role: "primary", base: primary });
  if (fallback && fallback !== primary) targets.push({ role: "fallback", base: fallback });
  return targets;
}

function isIdempotent(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")
  );
}

function isConnectFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: { code?: unknown } }).cause;
  const code = typeof cause?.code === "string" ? cause.code : "";
  if (CONNECT_FAILURE_CODES.has(code)) return true;
  return [...CONNECT_FAILURE_CODES].some((failureCode) => error.message.includes(failureCode));
}

function orderedTargets(targets: BackendTarget[]): BackendTarget[] {
  if (targets.length < 2 || Date.now() >= primaryDownUntil) return targets;
  return [
    ...targets.filter((t) => t.role === "fallback"),
    ...targets.filter((t) => t.role === "primary"),
  ];
}

function markFailure(target: BackendTarget): void {
  if (target.role === "primary") primaryDownUntil = Date.now() + PRIMARY_COOLDOWN_MS;
}

function markSuccess(target: BackendTarget): void {
  if (target.role === "primary") primaryDownUntil = 0;
}

export async function fetchBackend(
  targets: BackendTarget[],
  request: BackendRequest,
): Promise<BackendFetchResult> {
  const order = orderedTargets(targets);
  const idempotent = isIdempotent(request.method);
  // With a single backend, give an idempotent request one retry while a sleeping
  // instance wakes up. With two backends, the second target plays that role.
  const attempts = order.length === 1 && idempotent && order[0] ? [order[0], order[0]] : order;

  let lastFailure: BackendFetchResult = {
    ok: false,
    reason: "Backend URL is not configured",
    timedOut: false,
  };

  for (const [index, target] of attempts.entries()) {
    const isLast = index === attempts.length - 1;
    if (index > 0 && attempts[index - 1] === target) {
      await new Promise((resolve) => setTimeout(resolve, WAKE_RETRY_DELAY_MS));
    }

    const headers = new Headers(request.headers);
    // Stops ngrok's free-plan browser interstitial from replacing API responses.
    headers.set("ngrok-skip-browser-warning", "true");
    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(request.timeoutMs),
    };
    if (request.body !== undefined && !idempotent) init.body = request.body;

    try {
      const response = await fetch(`${target.base}${request.path}`, init);
      if (UNAVAILABLE_STATUSES.has(response.status) && idempotent && !isLast) {
        markFailure(target);
        console.warn(
          `[${request.logLabel}] ${target.role} backend returned ${response.status}, trying next`,
        );
        await response.body?.cancel();
        continue;
      }
      if (!UNAVAILABLE_STATUSES.has(response.status)) markSuccess(target);
      return { ok: true, response, role: target.role };
    } catch (error) {
      const timedOut = isTimeout(error);
      const reason = error instanceof Error ? error.message : "Unknown upstream error";
      lastFailure = { ok: false, reason, timedOut };
      // A slow non-idempotent request may still be running on the backend,
      // so it neither fails over nor marks the backend as down.
      const canTryNext = isConnectFailure(error) || idempotent;
      if (!canTryNext) return lastFailure;
      markFailure(target);
      if (isLast) return lastFailure;
      console.warn(`[${request.logLabel}] ${target.role} backend failed (${reason}), trying next`);
    }
  }

  return lastFailure;
}

/** Copies an upstream response for the browser, tagging which backend served it. */
export function toProxyResponse(result: { response: Response; role: BackendRole }): Response {
  const headers = new Headers(result.response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("cache-control", "no-store");
  headers.set("x-orbit-backend", result.role);
  return new Response(result.response.body, {
    status: result.response.status,
    statusText: result.response.statusText,
    headers,
  });
}
