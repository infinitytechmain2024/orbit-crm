import { createFileRoute } from "@tanstack/react-router";
import {
  fetchBackend,
  resolveBackendTargets,
  toProxyResponse,
} from "@/lib/server/backend-upstream";
import { verifyProxyUser } from "@/lib/server/verify-proxy-user";

export const Route = createFileRoute("/api/backend/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxyRequest(request, params._splat, "GET"),
      POST: ({ request, params }) => proxyRequest(request, params._splat, "POST"),
      PUT: ({ request, params }) => proxyRequest(request, params._splat, "PUT"),
      PATCH: ({ request, params }) => proxyRequest(request, params._splat, "PATCH"),
      DELETE: ({ request, params }) => proxyRequest(request, params._splat, "DELETE"),
    },
  },
});

async function proxyRequest(
  request: Request,
  path: string | undefined,
  method: string,
): Promise<Response> {
  const authenticationError = await verifyProxyUser(request);
  if (authenticationError) return authenticationError;
  const targets = resolveBackendTargets();
  if (targets.length === 0) {
    return Response.json({ error: "Backend URL is not configured on the server" }, { status: 503 });
  }

  const token = process.env.INTERNAL_API_TOKEN;
  if (!token) {
    return Response.json(
      { error: "Backend proxy authentication is not configured" },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const userAuthorization = headers.get("authorization");
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  if (userAuthorization) headers.set("x-supabase-authorization", userAuthorization);
  headers.set("authorization", `Bearer ${token}`);

  // Determine timeout based on endpoint type
  const isTranscribe = path?.includes("transcribe");
  const isAiWorkflow = path?.includes("ai-workflow");
  const timeoutMs = isAiWorkflow ? 90_000 : isTranscribe ? 120_000 : 30_000;

  const result = await fetchBackend(targets, {
    method,
    path: `${path ? `/${path}` : ""}${url.search}`,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    timeoutMs,
    logLabel: "backend proxy",
  });

  if (!result.ok) {
    console.error("[backend proxy] upstream request failed", {
      method,
      path: path ?? "",
      reason: result.reason,
      isTimeout: result.timedOut,
    });
    return Response.json(
      {
        error: result.timedOut
          ? "Backend is waking up, please try again"
          : "Backend is unavailable",
      },
      { status: 502 },
    );
  }

  return toProxyResponse(result);
}
