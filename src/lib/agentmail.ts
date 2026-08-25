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

export async function fetchEmails(organizationId: string): Promise<Email[]> {
  const query = new URLSearchParams({ organization_id: organizationId });
  const response = await authenticatedFetch(`/api/mail/messages?${query}`);
  const payload = (await response.json().catch(() => ({}))) as Email[] | { error?: string };
  if (!response.ok) {
    throw new Error(
      !Array.isArray(payload) && payload.error ? payload.error : "Mail service request failed",
    );
  }
  return payload as Email[];
}

export async function sendReply(params: {
  organizationId: string;
  messageId: string;
  text: string;
  html?: string;
}): Promise<void> {
  await request("reply", { ...params, confirmed: true, idempotencyKey: crypto.randomUUID() });
}

export async function sendMessage(params: {
  organizationId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  labels?: string[];
}): Promise<{ messageId: string }> {
  return request<{ messageId: string }>("send", {
    ...params,
    confirmed: true,
    idempotencyKey: crypto.randomUUID(),
  });
}
