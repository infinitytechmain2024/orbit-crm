import { AgentMailClient } from "agentmail";
import type { Email } from "./crm-data";

const API_KEY = import.meta.env["VITE_AGENTMAIL_API_KEY"] as string | undefined;
const INBOX_ID = (import.meta.env["VITE_AGENTMAIL_INBOX"] as string) || "outreach@agentmail.to";

let client: AgentMailClient | null = null;

function getClient(): AgentMailClient {
  if (!client) {
    if (!API_KEY) throw new Error("AGENTMAIL_API_KEY is not set in environment variables");
    client = new AgentMailClient({ apiKey: API_KEY });
  }
  return client;
}

function formatTimestamp(ts: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - ts.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMin / 60);

  if (diffMin < 1) return "Только что";
  if (diffMin < 60) return `${diffMin} мин.`;
  if (diffH < 24) return `${diffH} ч.`;

  const isThisYear = ts.getFullYear() === now.getFullYear();
  const day = String(ts.getDate()).padStart(2, "0");
  const month = String(ts.getMonth() + 1).padStart(2, "0");
  return isThisYear ? `${day}.${month}` : `${day}.${month}.${ts.getFullYear()}`;
}

function parseFrom(from: unknown): string {
  if (typeof from === "string") return from;
  if (Array.isArray(from) && from.length > 0) {
    const first = from[0] as { address?: string; name?: string };
    if (first.name) return first.name;
    if (first.address) return first.address;
  }
  return "Неизвестный отправитель";
}

function extractPreview(preview?: string): string {
  if (!preview) return "";
  const stripped = preview
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 120 ? stripped.slice(0, 120) + "…" : stripped;
}

export async function createInbox(options?: {
  username?: string;
  domain?: string;
  displayName?: string;
  clientId?: string;
}): Promise<{ inboxId: string; email: string }> {
  const c = getClient();
  const request: { username?: string; domain?: string; displayName?: string; clientId?: string } = {};
  if (options?.username) request.username = options.username;
  if (options?.domain) request.domain = options.domain;
  if (options?.displayName) request.displayName = options.displayName;
  if (options?.clientId) request.clientId = options.clientId;
  const inbox = await c.inboxes.create(request);
  return { inboxId: inbox.inboxId, email: inbox.email };
}

export async function listInboxes(): Promise<
  Array<{ inboxId: string; email: string; displayName?: string }>
> {
  const c = getClient();
  const response = await c.inboxes.list();
  return (response.inboxes ?? []).map((inbox) => ({
    inboxId: inbox.inboxId,
    email: inbox.email,
    ...(inbox.displayName ? { displayName: inbox.displayName } : {}),
  }));
}

export async function fetchEmails(): Promise<Email[]> {
  const c = getClient();
  const response = await c.inboxes.messages.list(INBOX_ID, { limit: 50 });
  const messages = response.messages ?? [];

  return messages.map((msg) => ({
    id: msg.messageId,
    from: parseFrom(msg.from),
    subject: msg.subject || "(Без темы)",
    preview: extractPreview(msg.preview),
    body: msg.preview || "",
    date: formatTimestamp(msg.timestamp),
    unread: msg.labels?.includes("unread") ?? true,
    createdAt: msg.timestamp.toISOString(),
  }));
}

export async function sendReply(params: {
  inboxId: string;
  messageId: string;
  text: string;
  html?: string;
}): Promise<void> {
  const c = getClient();
  const request: { text: string; html?: string } = { text: params.text };
  if (params.html) request.html = params.html;
  await c.inboxes.messages.reply(params.inboxId, params.messageId, request);
}

export async function sendMessage(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  labels?: string[];
}): Promise<{ messageId: string }> {
  const c = getClient();
  const request: {
    to: string[];
    subject: string;
    text: string;
    html?: string;
    labels?: string[];
  } = {
    to: [params.to],
    subject: params.subject,
    text: params.text,
  };
  if (params.html) request.html = params.html;
  if (params.labels) request.labels = params.labels;
  const sent = await c.inboxes.messages.send(INBOX_ID, request);
  return { messageId: sent.messageId };
}

export type ThreadSummary = {
  threadId: string;
  subject: string;
  preview: string;
  senders: string[];
  recipients: string[];
  messageCount: number;
  date: string;
  unread: boolean;
  lastMessageId: string;
};

export async function listThreads(limit = 50): Promise<ThreadSummary[]> {
  const c = getClient();
  const response = await c.inboxes.threads.list(INBOX_ID, { limit });
  const threads = response.threads ?? [];

  return threads.map((t) => ({
    threadId: t.threadId,
    subject: t.subject || "(Без темы)",
    preview: extractPreview(t.preview),
    senders: t.senders ?? [],
    recipients: t.recipients ?? [],
    messageCount: t.messageCount ?? 1,
    date: formatTimestamp(t.timestamp),
    unread: t.labels?.includes("unread") ?? true,
    lastMessageId: t.lastMessageId,
  }));
}
