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
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const direct = await fetch(`${API_URL.replace(/\/$/, "")}/api/lead-search`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    const directResult = await readLeadSearchResponse(direct);
    if (directResult.ok) {
      return directResult.response;
    }

    const fallback = await fetch(new URL("/api/backend/api/lead-search", request.url), {
      method: "POST",
      headers: {
        ...headers,
        authorization: request.headers.get("authorization") || "",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    const fallbackResult = await readLeadSearchResponse(fallback);
    if (fallbackResult.ok) {
      return fallbackResult.response;
    }

    return Response.json(
      {
        error: "Lead search backend returned an unexpected response",
        direct: directResult.error,
        fallback: fallbackResult.error,
        leads: [],
        total: 0,
      },
      { status: 502 },
    );
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

async function readLeadSearchResponse(response: Response): Promise<
  | { ok: true; response: Response }
  | {
      ok: false;
      error: {
        status: number;
        contentType: string | null;
        detail: string;
      };
    }
> {
  const text = await response.text();
  const contentType = response.headers.get("content-type");
  const looksLikeJson =
    (contentType?.includes("application/json") ?? false) ||
    text.trimStart().startsWith("{") ||
    text.trimStart().startsWith("[");

  if (!looksLikeJson) {
    return {
      ok: false,
      error: {
        status: response.status,
        contentType,
        detail: text.slice(0, 500),
      },
    };
  }

  return {
    ok: true,
    response: new Response(text, {
      status: response.status,
      headers: { "Content-Type": contentType || "application/json" },
    }),
  };
}
