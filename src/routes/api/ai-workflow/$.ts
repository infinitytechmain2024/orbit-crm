import { createFileRoute } from "@tanstack/react-router";
import {
  fetchBackend,
  resolveBackendTargets,
  toProxyResponse,
} from "@/lib/server/backend-upstream";

// AI workflow calls can run long; stay above the backend's own model timeouts.
const WORKFLOW_TIMEOUT_MS = 130_000;

export const Route = createFileRoute("/api/ai-workflow/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxyWorkflowRequest(request, params._splat, "GET"),
      POST: ({ request, params }) => proxyWorkflowRequest(request, params._splat, "POST"),
      PATCH: ({ request, params }) => proxyWorkflowRequest(request, params._splat, "PATCH"),
    },
  },
});

async function proxyWorkflowRequest(
  request: Request,
  path: string | undefined,
  method: string,
): Promise<Response> {
  const targets = resolveBackendTargets({
    legacyUrlKeys: ["AI_WORKFLOW_BACKEND_URL", "RENDER_BACKEND_URL", "BACKEND_URL"],
  });
  if (targets.length === 0) {
    return Response.json({ error: "AI Workflow backend URL is not configured" }, { status: 503 });
  }
  const internalToken = process.env["INTERNAL_API_TOKEN"];
  if (!internalToken) {
    return Response.json(
      { error: "AI Workflow server authentication is not configured" },
      { status: 503 },
    );
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
    path: `/api/ai-workflow${path ? `/${path}` : ""}${incomingUrl.search}`,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    timeoutMs: WORKFLOW_TIMEOUT_MS,
    logLabel: "ai-workflow proxy",
  });
  if (!result.ok) {
    console.error("[ai-workflow proxy] upstream request failed", {
      method,
      path: path ?? "",
      reason: result.reason,
    });
    return Response.json({ error: "AI Workflow backend is unavailable" }, { status: 502 });
  }

  return toProxyResponse(result);
}
