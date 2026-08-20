import type { VercelRequest, VercelResponse } from "@vercel/node";

const BACKEND_URL = process.env.BACKEND_URL;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!BACKEND_URL) {
    return res.status(503).json({
      detail: "BACKEND_URL is not configured",
    });
  }

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Supabase-Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Extract the path after /api/
  const proxyPath = req.url?.replace(/^\/api\//, "") || "";
  const targetUrl = `${BACKEND_URL}/api/${proxyPath}`;

  try {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase() === "host") continue;
      if (typeof value === "string") {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value[0];
      }
    }

    const fetchInit: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
      fetchInit.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, fetchInit);
    const data = await response.text();

    // Forward status and content-type
    const contentType = response.headers.get("content-type") || "application/json";
    res.setHeader("Content-Type", contentType);

    return res.status(response.status).send(data);
  } catch (error: any) {
    console.error("Proxy error:", error.message);
    return res.status(502).json({
      detail: `Backend proxy error: ${error.message}`,
    });
  }
}
