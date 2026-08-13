import { createFileRoute } from "@tanstack/react-router";

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const DEFAULT_MODEL = "whisper-large-v3-turbo";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TRANSCRIPTION_TIMEOUT_MS = 60_000;
const LOCAL_TRANSCRIPTION_TIMEOUT_MS = 120_000;

type ProviderResponse = {
  text?: unknown;
  error?: { message?: unknown };
};

export const Route = createFileRoute("/api/speech/transcribe")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          { status: isTranscriptionConfigured() ? "ok" : "unavailable" },
          {
            status: isTranscriptionConfigured() ? 200 : 503,
            headers: { "cache-control": "no-store" },
          },
        ),
      POST: ({ request }) => transcribe(request),
    },
  },
});

function localBackendConfig(): { base: string; token: string } | null {
  const base =
    process.env["RENDER_BACKEND_URL"] ||
    process.env["BACKEND_URL"] ||
    process.env["AI_WORKFLOW_BACKEND_URL"] ||
    (process.env["NODE_ENV"] === "development" ? "http://127.0.0.1:8000" : "");
  const token = process.env["INTERNAL_API_TOKEN"] || "";
  return base && token ? { base: base.replace(/\/$/, ""), token } : null;
}

function isTranscriptionConfigured(): boolean {
  return Boolean(process.env["GROQ_API_KEY"] || localBackendConfig());
}

async function verifyUser(request: Request): Promise<Response | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return Response.json({ error: "Authentication is required" }, { status: 401 });
  }

  const supabaseUrl = process.env["VITE_SUPABASE_URL"]?.replace(/\/$/, "");
  const publishableKey = process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !publishableKey) {
    return Response.json({ error: "Authentication service is not configured" }, { status: 503 });
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: publishableKey,
        authorization,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return Response.json({ error: "Invalid or expired session" }, { status: 401 });
    }
  } catch (error) {
    console.error("[speech] authentication check failed", {
      reason: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json({ error: "Authentication service is unavailable" }, { status: 503 });
  }

  return null;
}

async function transcribe(request: Request): Promise<Response> {
  const authError = await verifyUser(request);
  if (authError) return authError;

  let incomingForm: FormData;
  try {
    incomingForm = await request.formData();
  } catch {
    return Response.json({ error: "Expected a multipart audio upload" }, { status: 400 });
  }

  const audio = incomingForm.get("audio");
  if (!(audio instanceof Blob)) {
    return Response.json({ error: 'Missing multipart field "audio"' }, { status: 400 });
  }
  if (audio.size === 0) {
    return Response.json({ error: "Uploaded audio file is empty" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "Audio file exceeds the 25 MB limit" }, { status: 413 });
  }

  const fileName = audio instanceof File && audio.name ? audio.name : "recording.webm";
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) {
    const localBackend = localBackendConfig();
    if (!localBackend) {
      return Response.json(
        { error: "Speech transcription is not configured on the server" },
        { status: 503 },
      );
    }
    return transcribeWithLocalBackend(audio, fileName, localBackend);
  }

  const providerForm = new FormData();
  providerForm.append("file", audio, fileName);
  providerForm.append("model", process.env["GROQ_WHISPER_MODEL"] || DEFAULT_MODEL);
  providerForm.append("language", process.env["WHISPER_LANGUAGE"] || "ru");
  providerForm.append("response_format", "json");
  providerForm.append("temperature", "0");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);

  try {
    const upstream = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: providerForm,
      signal: controller.signal,
    });
    const responseText = await upstream.text();
    let payload: ProviderResponse = {};
    try {
      payload = JSON.parse(responseText) as ProviderResponse;
    } catch {
      // Use the stable error below when the provider returns an unexpected body.
    }

    if (!upstream.ok) {
      const providerMessage =
        typeof payload.error?.message === "string" ? payload.error.message : "Provider error";
      console.error("[speech] transcription provider rejected request", {
        status: upstream.status,
        message: providerMessage,
      });
      return Response.json(
        { error: `Speech transcription failed (${upstream.status})` },
        {
          status: upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502,
          headers: { "cache-control": "no-store" },
        },
      );
    }

    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) {
      return Response.json(
        { error: "No speech detected in the audio" },
        { status: 422, headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      { text, success: true, language: process.env["WHISPER_LANGUAGE"] || "ru" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    console.error("[speech] transcription provider unavailable", {
      timedOut,
      reason: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      { error: timedOut ? "Speech transcription timed out" : "Speech provider is unavailable" },
      { status: timedOut ? 504 : 502, headers: { "cache-control": "no-store" } },
    );
  } finally {
    clearTimeout(timer);
  }
}

async function transcribeWithLocalBackend(
  audio: Blob,
  fileName: string,
  config: { base: string; token: string },
): Promise<Response> {
  const form = new FormData();
  form.append("audio", audio, fileName);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOCAL_TRANSCRIPTION_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${config.base}/api/speech/transcribe`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}` },
      body: form,
      signal: controller.signal,
    });
    const headers = new Headers(upstream.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.set("cache-control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    console.error("[speech] local transcription backend unavailable", {
      timedOut,
      reason: error instanceof Error ? error.message : "Unknown error",
    });
    return Response.json(
      { error: timedOut ? "Speech transcription timed out" : "Speech backend is unavailable" },
      { status: timedOut ? 504 : 502, headers: { "cache-control": "no-store" } },
    );
  } finally {
    clearTimeout(timer);
  }
}
