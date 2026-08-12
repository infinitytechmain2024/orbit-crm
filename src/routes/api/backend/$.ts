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
  const base = process.env.RENDER_BACKEND_URL;
  if (!base) {
    return Response.json(
      { error: "RENDER_BACKEND_URL is not configured on the server" },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const target = `${base}${path ? `/${path}` : ""}${url.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.delete("connection");

  const token = process.env.INTERNAL_API_TOKEN;
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
  }

  const upstream = await fetch(target, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
    redirect: "manual",
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
