import { createFileRoute } from "@tanstack/react-router";
import { AgentMailClient } from "agentmail";

export const Route = createFileRoute("/api/mail/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleMail(request, params._splat, "GET"),
      POST: ({ request, params }) => handleMail(request, params._splat, "POST"),
    },
  },
});

async function authenticate(request: Request): Promise<boolean> {
  const authorization = request.headers.get("authorization") ?? "";
  const supabaseUrl = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"];
  const publishableKey =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!authorization.startsWith("Bearer ") || !supabaseUrl || !publishableKey) return false;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { authorization, apikey: publishableKey },
  });
  return response.ok;
}

function parseSender(from: unknown): string {
  if (typeof from === "string") return from;
  if (Array.isArray(from) && from.length) {
    const sender = from[0] as { address?: string; name?: string };
    return sender.name || sender.address || "Неизвестный отправитель";
  }
  return "Неизвестный отправитель";
}

async function handleMail(request: Request, action: string | undefined, method: string) {
  if (!(await authenticate(request)))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env["AGENTMAIL_API_KEY"];
  const inboxId = process.env["AGENTMAIL_INBOX"] ?? process.env["VITE_AGENTMAIL_INBOX"];
  if (!apiKey || !inboxId) {
    return Response.json({ error: "Mail service is not configured" }, { status: 503 });
  }
  const client = new AgentMailClient({ apiKey });
  try {
    if (method === "GET" && action === "messages") {
      const response = await client.inboxes.messages.list(inboxId, { limit: 50 });
      return Response.json(
        (response.messages ?? []).map((message) => ({
          id: message.messageId,
          from: parseSender(message.from),
          subject: message.subject || "(Без темы)",
          preview: (message.preview ?? "").replace(/<[^>]*>/g, "").slice(0, 120),
          body: message.preview || "",
          date: message.timestamp.toISOString(),
          unread: message.labels?.includes("unread") ?? true,
          createdAt: message.timestamp.toISOString(),
        })),
        { headers: { "cache-control": "no-store" } },
      );
    }
    const body = (await request.json()) as Record<string, unknown>;
    if (action === "reply") {
      const messageId = String(body["messageId"] ?? "");
      const text = String(body["text"] ?? "");
      if (!messageId || !text) return Response.json({ error: "Invalid request" }, { status: 400 });
      await client.inboxes.messages.reply(inboxId, messageId, { text });
      return Response.json({ ok: true });
    }
    if (action === "send") {
      const to = String(body["to"] ?? "");
      const subject = String(body["subject"] ?? "");
      const messageText = String(body["text"] ?? "");
      if (!to || !subject || !messageText)
        return Response.json({ error: "Invalid request" }, { status: 400 });
      const sent = await client.inboxes.messages.send(inboxId, {
        to: [to],
        subject,
        text: messageText,
        labels: Array.isArray(body["labels"]) ? (body["labels"] as string[]) : undefined,
      });
      return Response.json({ messageId: sent.messageId });
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  } catch (error) {
    console.error("[mail api] request failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Mail service is unavailable" }, { status: 502 });
  }
}
