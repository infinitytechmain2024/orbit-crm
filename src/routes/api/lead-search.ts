import { createFileRoute } from "@tanstack/react-router";
import { fetchBackend, resolveBackendTargets } from "@/lib/server/backend-upstream";
import { verifyProxyUser } from "@/lib/server/verify-proxy-user";

const API_URL = import.meta.env["VITE_API_URL"] || "https://aura-crm-hn11.onrender.com";
const LEAD_SEARCH_TIMEOUT_MS = 120_000;

export const Route = createFileRoute("/api/lead-search")({
  server: {
    handlers: {
      POST: ({ request }) => proxyLeadSearch(request),
    },
  },
});

async function proxyLeadSearch(request: Request): Promise<Response> {
  const authenticationError = await verifyProxyUser(request);
  if (authenticationError) return authenticationError;
  const internalToken = process.env["INTERNAL_API_TOKEN"];
  if (!internalToken) {
    return Response.json(
      { error: "Lead search server authentication is not configured", leads: [], total: 0 },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const userAuthorization = request.headers.get("authorization") || "";
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const direct = await fetchBackend(
      resolveBackendTargets({ legacyUrlKeys: [], defaultPrimary: API_URL }),
      {
        method: "POST",
        path: "/api/lead-search",
        headers: new Headers({
          ...headers,
          authorization: `Bearer ${internalToken}`,
          "x-supabase-authorization": userAuthorization,
        }),
        body: JSON.stringify(body),
        timeoutMs: LEAD_SEARCH_TIMEOUT_MS,
        logLabel: "lead-search",
      },
    );

    const directResult = direct.ok
      ? await readLeadSearchResponse(direct.response)
      : ({
          ok: false,
          error: { status: 502, contentType: null, detail: direct.reason },
        } as const);
    if (directResult.ok) {
      return directResult.response;
    }

    const fallback = await fetch(new URL("/api/backend/api/lead-search", request.url), {
      method: "POST",
      headers: {
        ...headers,
        authorization: userAuthorization,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LEAD_SEARCH_TIMEOUT_MS),
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
