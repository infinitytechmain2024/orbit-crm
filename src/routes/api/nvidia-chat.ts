import { createFileRoute } from "@tanstack/react-router";

const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

export const Route = createFileRoute("/api/nvidia-chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.NVIDIA_API_KEY;
        if (!apiKey) {
          return Response.json(
            { error: "NVIDIA_API_KEY is not configured on the server" },
            { status: 500 },
          );
        }

        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "Invalid JSON body" }, { status: 400 });
        }

        const model =
          typeof body.model === "string" && body.model ? body.model : process.env.NVIDIA_MODEL;
        if (!model) {
          return Response.json(
            { error: 'Missing "model" in body or NVIDIA_MODEL env var' },
            { status: 400 },
          );
        }

        const upstream = await fetch(`${NIM_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ ...body, model }),
        });

        const contentType = upstream.headers.get("content-type") ?? "application/json";

        if (!upstream.ok) {
          const text = await upstream.text();
          return Response.json(
            { error: text, status: upstream.status },
            { status: upstream.status },
          );
        }

        return new Response(upstream.body, {
          status: upstream.status,
          headers: { "content-type": contentType },
        });
      },
    },
  },
});
