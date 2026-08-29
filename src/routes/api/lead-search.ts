import { createFileRoute } from "@tanstack/react-router";

const API_URL = import.meta.env["VITE_API_URL"] || "https://orbit-crm-backend.onrender.com";

export const Route = createFileRoute("/api/lead-search")({
  server: {
    handlers: {
      POST: ({ request }) => proxyLeadSearch(request),
    },
  },
});

async function proxyLeadSearch(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const res = await fetch(`${API_URL.replace(/\/$/, "")}/api/lead-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    const text = await res.text();
    const contentType = res.headers.get("content-type") || "";
    const looksLikeJson =
      contentType.includes("application/json") ||
      text.trimStart().startsWith("{") ||
      text.trimStart().startsWith("[");

    if (!looksLikeJson) {
      return Response.json(
        {
          error: "Lead search backend returned an unexpected response",
          upstreamStatus: res.status,
          upstreamContentType: contentType || null,
          detail: text.slice(0, 500),
          leads: [],
          total: 0,
        },
        { status: 502 },
      );
    }

    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": contentType || "application/json" },
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Lead search failed",
        leads: [],
        total: 0,
      },
      { status: 500 },
    );
  }
}
