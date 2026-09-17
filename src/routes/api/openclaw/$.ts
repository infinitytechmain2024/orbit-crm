import { createFileRoute } from "@tanstack/react-router";
import {
  fetchBackend,
  resolveBackendTargets,
  toProxyResponse,
} from "@/lib/server/backend-upstream";

// The backend waits up to OPENCLAW_REQUEST_TIMEOUT (120 s) for the gateway.
const OPENCLAW_TIMEOUT_MS = 130_000;

export const Route = createFileRoute("/api/openclaw/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxyOpenClawRequest(request, params._splat, "GET"),
      POST: ({ request, params }) => proxyOpenClawRequest(request, params._splat, "POST"),
      PATCH: ({ request, params }) => proxyOpenClawRequest(request, params._splat, "PATCH"),
    },
  },
});

async function proxyOpenClawRequest(
  request: Request,
  path: string | undefined,
  method: string,
): Promise<Response> {
  const targets = resolveBackendTargets({
    legacyUrlKeys: ["AI_WORKFLOW_BACKEND_URL", "RENDER_BACKEND_URL", "BACKEND_URL"],
  });
  const internalToken = process.env["INTERNAL_API_TOKEN"];
  if (targets.length === 0 || !internalToken) {
    return Response.json({ error: "OpenClaw backend is not configured" }, { status: 503 });
  }

  const incomingUrl = new URL(request.url);
  const headers = new Headers(request.headers);
  const userAuthorization = headers.get("authorization");
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  if (userAuthorization) headers.set("x-supabase-authorization", userAuthorization);
  headers.set("authorization", `Bearer ${internalToken}`);

  const result = await fetchBackend(targets, {
    method,
    path: `/api/openclaw${path ? `/${path}` : ""}${incomingUrl.search}`,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    timeoutMs: OPENCLAW_TIMEOUT_MS,
    logLabel: "openclaw proxy",
  });
  if (!result.ok) {
    console.error("[openclaw proxy] upstream request failed", {
      path: path ?? "",
      reason: result.reason,
    });
    return Response.json({ error: "OpenClaw backend is unavailable" }, { status: 502 });
  }

  return toProxyResponse(result);
}
