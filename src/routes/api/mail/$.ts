import { randomUUID } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { AgentMailClient } from "agentmail";
import { Webhook } from "svix";

export const Route = createFileRoute("/api/mail/$")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleMail(request, params._splat, "GET"),
      POST: ({ request, params }) => handleMail(request, params._splat, "POST"),
    },
  },
});

type AuthenticatedUser = { id: string; email?: string };
type JsonRecord = Record<string, unknown>;

function serverConfig() {
  return {
    supabaseUrl: process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "",
    publishableKey:
      process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
    serviceRoleKey: process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "",
  };
}

async function authenticate(request: Request): Promise<AuthenticatedUser | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const { supabaseUrl, publishableKey } = serverConfig();
  if (!authorization.startsWith("Bearer ") || !supabaseUrl || !publishableKey) return null;
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { authorization, apikey: publishableKey },
  });
  if (!response.ok) return null;
  const user = (await response.json()) as AuthenticatedUser;
  return user.id ? user : null;
}

async function adminRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const { supabaseUrl, serviceRoleKey } = serverConfig();
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase server credentials are missing");
  const headers = new Headers(init.headers);
  headers.set("apikey", serviceRoleKey);
  headers.set("authorization", `Bearer ${serviceRoleKey}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/${path}`, { ...init, headers });
}

async function requireMembership(organizationId: string, userId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return false;
  const query = new URLSearchParams({
    organization_id: `eq.${organizationId}`,
    user_id: `eq.${userId}`,
    select: "user_id",
    limit: "1",
  });
  const response = await adminRequest(`organization_members?${query}`);
  return response.ok && ((await response.json()) as unknown[]).length === 1;
}

async function findCommunication(
  organizationId: string,
  idempotencyKey: string,
): Promise<JsonRecord | null> {
  const query = new URLSearchParams({
    organization_id: `eq.${organizationId}`,
    channel: "eq.email",
    idempotency_key: `eq.${idempotencyKey}`,
    select: "id,status,provider_message_id",
    limit: "1",
  });
  const response = await adminRequest(`communication_events?${query}`);
  if (!response.ok) throw new Error("Communication log lookup failed");
  return ((await response.json()) as JsonRecord[])[0] ?? null;
}

async function insertCommunication(record: JsonRecord): Promise<JsonRecord> {
  const response = await adminRequest("communication_events", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(record),
  });
  if (!response.ok) throw new Error("Communication log insert failed");
  return ((await response.json()) as JsonRecord[])[0];
}

async function updateCommunication(id: string, patch: JsonRecord): Promise<void> {
  const response = await adminRequest(`communication_events?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error("Communication log update failed");
}

function parseSender(from: unknown): string {
  if (typeof from === "string") return from;
  if (Array.isArray(from) && from.length) {
    const sender = from[0] as { address?: string; name?: string };
    return sender.name || sender.address || "Неизвестный отправитель";
  }
  return "Неизвестный отправитель";
}

async function handleWebhook(request: Request): Promise<Response> {
  const secret = process.env["AGENTMAIL_WEBHOOK_SECRET"];
  const organizationId = process.env["AGENTMAIL_ORGANIZATION_ID"];
  if (!secret || !organizationId)
    return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  const rawBody = await request.text();
  const svixId = request.headers.get("svix-id") ?? "";
  try {
    new Webhook(secret).verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "",
    });
  } catch {
    return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
  }
  if (!svixId) return Response.json({ error: "Missing webhook id" }, { status: 400 });
  const existing = await findCommunication(organizationId, `webhook:${svixId}`);
  if (existing) return Response.json({ ok: true, replayed: true });
  const payload = JSON.parse(rawBody) as JsonRecord;
  const message = (payload["message"] ?? payload["data"] ?? {}) as JsonRecord;
  await insertCommunication({
    organization_id: organizationId,
    channel: "email",
    direction: "inbound",
    action: "webhook",
    status: "received",
    provider_message_id: String(message["message_id"] ?? message["messageId"] ?? "") || null,
    idempotency_key: `webhook:${svixId}`,
    subject: String(message["subject"] ?? "").slice(0, 500) || null,
    source: "provider_webhook",
    metadata: { event_type: String(payload["event_type"] ?? payload["type"] ?? "unknown") },
    completed_at: new Date().toISOString(),
  });
  return Response.json({ ok: true, replayed: false });
}

async function handleMail(request: Request, action: string | undefined, method: string) {
  if (method === "POST" && action === "webhook") return handleWebhook(request);
  try {
    const user = await authenticate(request);
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const body = method === "GET" ? null : ((await request.json()) as JsonRecord);
    const organizationId =
      method === "GET"
        ? (new URL(request.url).searchParams.get("organization_id") ?? "")
        : String(body?.["organizationId"] ?? "");
    if (!(await requireMembership(organizationId, user.id)))
      return Response.json({ error: "Organization access denied" }, { status: 403 });

    const apiKey = process.env["AGENTMAIL_API_KEY"];
    const inboxId = process.env["AGENTMAIL_INBOX"];
    if (!apiKey || !inboxId)
      return Response.json({ error: "Mail service is not configured" }, { status: 503 });
    const client = new AgentMailClient({ apiKey });
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
    if (!body || body["confirmed"] !== true)
      return Response.json({ error: "Explicit confirmation is required" }, { status: 409 });
    if (action !== "reply" && action !== "send")
      return Response.json({ error: "Not found" }, { status: 404 });
    const idempotencyKey = String(body["idempotencyKey"] ?? randomUUID());
    if (idempotencyKey.length < 8 || idempotencyKey.length > 240)
      return Response.json({ error: "Invalid idempotency key" }, { status: 400 });
    const existing = await findCommunication(organizationId, idempotencyKey);
    if (existing) {
      if (existing["status"] === "sent")
        return Response.json({
          messageId: existing["provider_message_id"],
          idempotencyReplayed: true,
        });
      return Response.json({ error: "Delivery is already processing" }, { status: 409 });
    }
    const recipient = action === "send" ? String(body["to"] ?? "") : null;
    const subject = action === "send" ? String(body["subject"] ?? "") : null;
    const log = await insertCommunication({
      organization_id: organizationId,
      user_id: user.id,
      channel: "email",
      direction: "outbound",
      action,
      status: "processing",
      idempotency_key: idempotencyKey,
      recipient,
      subject,
      source: "user",
      metadata: { explicitly_confirmed: true },
      confirmed_at: new Date().toISOString(),
    });
    try {
      let messageId: string;
      if (action === "reply") {
        const replyTo = String(body["messageId"] ?? "");
        const text = String(body["text"] ?? "");
        if (!replyTo || !text) throw new Error("Invalid reply request");
        messageId = (await client.inboxes.messages.reply(inboxId, replyTo, { text })).messageId;
      } else {
        const text = String(body["text"] ?? "");
        if (!recipient || !subject || !text) throw new Error("Invalid send request");
        messageId = (
          await client.inboxes.messages.send(inboxId, {
            to: [recipient],
            subject,
            text,
            labels: Array.isArray(body["labels"]) ? (body["labels"] as string[]) : undefined,
          })
        ).messageId;
      }
      await updateCommunication(String(log["id"]), {
        status: "sent",
        provider_message_id: messageId,
        completed_at: new Date().toISOString(),
      });
      return Response.json({ messageId, idempotencyReplayed: false });
    } catch (error) {
      await updateCommunication(String(log["id"]), {
        status: "failed",
        error: error instanceof Error ? error.message.slice(0, 1000) : "Provider failure",
        completed_at: new Date().toISOString(),
      });
      throw error;
    }
  } catch (error) {
    console.error("[mail api] request failed", error instanceof Error ? error.message : error);
    return Response.json({ error: "Mail service is unavailable" }, { status: 502 });
  }
}
