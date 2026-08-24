import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/learning/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => proxyLearning(request, params._splat, "GET"),
      POST: ({ request, params }) => proxyLearning(request, params._splat, "POST"),
    },
  },
});

async function proxyLearning(request: Request, path: string | undefined, method: string) {
  const base =
    process.env["AI_WORKFLOW_BACKEND_URL"] ??
    process.env["RENDER_BACKEND_URL"] ??
    process.env["BACKEND_URL"] ??
    (process.env["NODE_ENV"] === "development" ? "http://127.0.0.1:8000" : "");
  const internalToken = process.env["INTERNAL_API_TOKEN"];
  if (!base || !internalToken)
    return Response.json({ error: "Learning backend is not configured" }, { status: 503 });
  const url = new URL(request.url);
  const target = `${base.replace(/\/$/, "")}/api/learning${path ? `/${path}` : ""}${url.search}`;
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
      body: method === "GET" ? undefined : await request.arrayBuffer(),
      redirect: "manual",
    });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete("content-length");
    responseHeaders.delete("content-encoding");
    responseHeaders.set("cache-control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error(
      "[learning proxy] upstream unavailable",
      error instanceof Error ? error.message : error,
    );
    return Response.json({ error: "Learning backend is unavailable" }, { status: 502 });
  }
}
