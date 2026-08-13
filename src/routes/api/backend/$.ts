import { createFileRoute } from "@tanstack/react-router";

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
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  headers.delete("authorization");
  headers.set("authorization", `Bearer ${token}`);

  // Render free plan cold start can take 30-60s; allow enough time.
  const isTranscribe = path?.includes("transcribe");
  const timeoutMs = isTranscribe ? 120_000 : 30_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    clearTimeout(timer);
    const reason = error instanceof Error ? error.message : "Unknown upstream error";
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
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
