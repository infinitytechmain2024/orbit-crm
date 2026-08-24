import { createFileRoute } from "@tanstack/react-router";

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
  const base =
    process.env["AI_WORKFLOW_BACKEND_URL"] ??
    process.env["RENDER_BACKEND_URL"] ??
    process.env["BACKEND_URL"] ??
    (process.env["NODE_ENV"] === "development" ? "http://127.0.0.1:8000" : "");
  const internalToken = process.env["INTERNAL_API_TOKEN"];
  if (!base || !internalToken) {
    return Response.json({ error: "OpenClaw backend is not configured" }, { status: 503 });
  }

  const incomingUrl = new URL(request.url);
  const target = `${base.replace(/\/$/, "")}/api/openclaw${path ? `/${path}` : ""}${incomingUrl.search}`;
  const headers = new Headers(request.headers);
  const userAuthorization = headers.get("authorization");
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  if (userAuthorization) headers.set("x-supabase-authorization", userAuthorization);
  headers.set("authorization", `Bearer ${internalToken}`);

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
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error("[openclaw proxy] upstream request failed", {
      path: path ?? "",
      reason: error instanceof Error ? error.message : "Unknown upstream error",
    });
    return Response.json({ error: "OpenClaw backend is unavailable" }, { status: 502 });
  }
}
