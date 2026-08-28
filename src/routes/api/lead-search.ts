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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("Content-Type") || "application/json" },
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
