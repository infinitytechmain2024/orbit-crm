import { createFileRoute } from "@tanstack/react-router";
import {
  fetchBackend,
  resolveBackendTargets,
  toProxyResponse,
} from "@/lib/server/backend-upstream";

const LEARNING_TIMEOUT_MS = 60_000;

export const Route = createFileRoute("/api/learning/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxyLearning(request, params._splat, "GET"),
      POST: ({ request, params }) => proxyLearning(request, params._splat, "POST"),
    },
  },
});

async function proxyLearning(request: Request, path: string | undefined, method: string) {
  const targets = resolveBackendTargets({
    legacyUrlKeys: ["AI_WORKFLOW_BACKEND_URL", "RENDER_BACKEND_URL", "BACKEND_URL"],
  });
  const internalToken = process.env["INTERNAL_API_TOKEN"];
  if (targets.length === 0 || !internalToken)
    return Response.json({ error: "Learning backend is not configured" }, { status: 503 });
  const url = new URL(request.url);
  const headers = new Headers(request.headers);
  const userAuthorization = headers.get("authorization");
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  if (userAuthorization) headers.set("x-supabase-authorization", userAuthorization);
  headers.set("authorization", `Bearer ${internalToken}`);

  const result = await fetchBackend(targets, {
    method,
    path: `/api/learning${path ? `/${path}` : ""}${url.search}`,
    headers,
    body: method === "GET" ? undefined : await request.arrayBuffer(),
    timeoutMs: LEARNING_TIMEOUT_MS,
    logLabel: "learning proxy",
  });
  if (!result.ok) {
    console.error("[learning proxy] upstream unavailable", result.reason);
    return Response.json({ error: "Learning backend is unavailable" }, { status: 502 });
  }
  return toProxyResponse(result);
}
