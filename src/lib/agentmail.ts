import type { Email } from "./crm-data";
import { authenticatedFetch } from "./api-client";

async function request<T>(action: string, body?: unknown): Promise<T> {
  const response = await authenticatedFetch(`/api/mail/${action}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Mail service request failed");
  return payload as T;
}

export async function fetchEmails(): Promise<Email[]> {
  return request<Email[]>("messages");
}

export async function sendReply(params: {
  inboxId: string;
  messageId: string;
  text: string;
  html?: string;
}): Promise<void> {
  await request("reply", params);
}

export async function sendMessage(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  labels?: string[];
}): Promise<{ messageId: string }> {
  return request<{ messageId: string }>("send", params);
}
