import { createFileRoute } from "@tanstack/react-router";

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
  const base =
    process.env["RENDER_BACKEND_URL"] ??
    process.env["VITE_API_URL"] ??
    (process.env["NODE_ENV"] === "development" ? "http://127.0.0.1:8000" : "");
  if (!base) {
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
  const target = `${base.replace(/\/$/, "")}/api/ai-workflow${path ? `/${path}` : ""}${incomingUrl.search}`;
  const headers = new Headers(request.headers);
  const userAuthorization = headers.get("authorization");
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");
  if (userAuthorization) headers.set("x-supabase-authorization", userAuthorization);
  headers.set("authorization", `Bearer ${internalToken}`);

  const requestInit: RequestInit = {
    method,
    headers,
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD") requestInit.body = await request.arrayBuffer();
  const upstream = await fetch(target, requestInit);

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-length");
  responseHeaders.delete("content-encoding");
  responseHeaders.set("cache-control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
