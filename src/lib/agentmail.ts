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

export async function sendReply(inboxId: string, messageId: string, text: string): Promise<void> {
  const c = getClient();
  await c.inboxes.messages.reply(inboxId, messageId, { text });
}

export async function sendMessage(to: string, subject: string, text: string): Promise<void> {
  const c = getClient();
  await c.inboxes.messages.send(INBOX_ID, { to: [to], subject, text });
}
