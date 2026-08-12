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

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
      redirect: "manual",
    });

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
    console.error("[backend proxy] upstream request failed", {
      method,
      path: path ?? "",
      reason: error instanceof Error ? error.message : "Unknown upstream error",
    });
    return Response.json({ error: "Backend is unavailable" }, { status: 502 });
  }
}
