import { createFileRoute } from "@tanstack/react-router";
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
  const base =
    process.env.RENDER_BACKEND_URL ||
    process.env.BACKEND_URL ||
    process.env.AI_WORKFLOW_BACKEND_URL ||
    (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "");
  if (!base) {
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
  const target = `${base.replace(/\/$/, "")}${path ? `/${path}` : ""}${url.search}`;

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let attempt = 0;
  const maxAttempts = 2;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const upstream = await fetch(target, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
        redirect: "manual",
        signal: controller.signal,
      });

      clearTimeout(timer);

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("content-length");
      responseHeaders.delete("content-encoding");
      responseHeaders.set("cache-control", "no-store");

      // Retry on 502/503 if not last attempt
      if ((upstream.status === 502 || upstream.status === 503) && attempt < maxAttempts) {
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      clearTimeout(timer);
      const reason = error instanceof Error ? error.message : "Unknown upstream error";
      const isTimeout = error instanceof DOMException && error.name === "AbortError";

      if (attempt < maxAttempts && (isTimeout || reason.includes("ECONNREFUSED") || reason.includes("ETIMEDOUT"))) {
        attempt++;
        logger.warn(`[backend proxy] retry attempt ${attempt}/${maxAttempts} after error: ${reason}`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      console.error("[backend proxy] upstream request failed", {
        method,
        path: path ?? "",
        reason,
        isTimeout,
      });
      return Response.json(
        { error: isTimeout ? "Backend is waking up, please try again" : "Backend is unavailable" },
        { status: 502 },
      );
    }
  }

  // Final attempt failed
  return Response.json(
    { error: "Backend is unavailable after retries" },
    { status: 502 },
  );
}
