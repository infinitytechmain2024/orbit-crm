import type { SearchFilters } from "../types/search";
import type { VoiceIntent } from "../types/voice";
import type { LiamCommand, LiamResponse } from "../types/agent";

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL || "http://localhost:11434/v1";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "ngrok-skip-browser-warning": "true",
};

interface LlmConfig {
  ollamaUrl: string;
  model: string;
}

function getConfig(): LlmConfig {
  return {
    ollamaUrl: import.meta.env["VITE_OLLAMA_URL"] ?? OLLAMA_URL,
    model: import.meta.env["VITE_LLM_MODEL"] ?? "llama3.2",
  };
}

async function callLlm(prompt: string): Promise<string> {
  const config = getConfig();
  const response = await fetch(`${config.ollamaUrl}/chat/completions`, {
    method: "POST",
    headers: COMMON_HEADERS,
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content:
            "You are Liam, an AI assistant for lead generation and CRM management. " +
            "You help parse user commands, generate search filters, create sales pitches, " +
            "and analyze business websites. Always respond in JSON format when asked to parse structured data.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown");
    throw new Error(`LLM API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? "";
}

export async function parseUserCommand(text: string): Promise<SearchFilters> {
  const prompt = `Parse this user command into search filters. Respond ONLY with JSON.

User command: "${text}"

Expected JSON format:
{
  "country": "United States",
  "countryFlag": "🇺🇸",
  "city": "city name or empty string",
  "niche": "business category or empty string",
  "websiteStatus": "no_website" | "needs_upgrade" | "all",
  "leadLimit": number (default 20)
}

Rules:
- If no city mentioned, use empty string
- If no niche mentioned, use empty string
- If "без сайта" / "no website" / "no site" mentioned, set websiteStatus to "no_website"
- If "требует доработки" / "needs upgrade" mentioned, set websiteStatus to "needs_upgrade"
- If no website status mentioned, default to "no_website"
- Extract numbers like "15 компаний" → leadLimit: 15
- Default country to United States with 🇺🇸 flag`;

  const response = await callLlm(prompt);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return getDefaultFilters();
    }
    const parsed = JSON.parse(jsonMatch[0]) as Partial<SearchFilters>;
    return {
      country: parsed.country ?? "United States",
      countryFlag: parsed.countryFlag ?? "🇺🇸",
      city: parsed.city ?? "",
      niche: parsed.niche ?? "",
      websiteStatus: parsed.websiteStatus ?? "no_website",
      leadLimit: parsed.leadLimit ?? 20,
    };
  } catch {
    return getDefaultFilters();
  }
}

function getDefaultFilters(): SearchFilters {
  return {
    country: "United States",
    countryFlag: "🇺🇸",
    city: "",
    niche: "",
    websiteStatus: "no_website",
    leadLimit: 20,
  };
}

export async function generateAiOffer(
  businessName: string,
  category: string,
  websiteUrl: string | null,
  cityLocation: string,
): Promise<{
  audit: string;
  proposal: string;
  callScript: string;
  weakPoints: string[];
  recommendations: string[];
}> {
  const websiteInfo = websiteUrl
    ? `Their website is: ${websiteUrl}`
    : "They DO NOT have a website.";

  const prompt = `Generate a sales pitch for a web development agency reaching out to "${businessName}" (${category}) in ${cityLocation}.

${websiteInfo}

Respond ONLY with JSON:
{
  "audit": "Brief analysis of their online presence (2-3 sentences)",
  "proposal": "Custom website offer with key benefits (3-4 sentences)",
  "callScript": "Personalized cold call script (5-7 sentences)",
  "weakPoints": ["weak point 1", "weak point 2"],
  "recommendations": ["recommendation 1", "recommendation 2"]
}

Write in English. Be professional but friendly. Focus on how a modern website can grow their business.`;

  const response = await callLlm(prompt);

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return getDefaultOffer(businessName, category);
    }
    return JSON.parse(jsonMatch[0]);
  } catch {
    return getDefaultOffer(businessName, category);
  }
}

function getDefaultOffer(
  businessName: string,
  category: string,
): {
  audit: string;
  proposal: string;
  callScript: string;
  weakPoints: string[];
  recommendations: string[];
} {
  return {
    audit: `${businessName} is a ${category} business that could benefit from a stronger online presence.`,
    proposal: `We specialize in building modern, mobile-friendly websites for ${category} businesses like ${businessName}. Our sites are designed to attract more local customers and drive growth.`,
    callScript: `Hi, I'm calling from Orbit Web Solutions. We help ${category} businesses like ${businessName} grow their customer base through professional websites. I noticed you might not have a strong online presence yet, and I'd love to show you how we can help.`,
    weakPoints: ["Limited online visibility", "Missing potential customers searching online"],
    recommendations: ["Create a mobile-responsive website", "Set up Google Business Profile"],
  };
}

export async function generateCallScript(
  businessName: string,
  category: string,
  cityLocation: string,
  websiteStatus: "no_website" | "needs_upgrade" | "good" | null,
): Promise<string> {
  const statusContext =
    websiteStatus === "no_website"
      ? "They don't have a website at all."
      : websiteStatus === "needs_upgrade"
        ? "They have a website but it needs significant improvements."
        : "They have a website that could still be enhanced.";

  const prompt = `Write a 30-second cold call script for reaching out to ${businessName}, a ${category} business in ${cityLocation}.

Context: ${statusContext}

The script should:
1. Introduce yourself and your agency
2. Mention something specific about their business
3. Point out the website issue naturally
4. Offer a solution
5. End with a clear call-to-action (schedule a meeting)

Keep it conversational and under 100 words. Write in English.`;

  return callLlm(prompt);
}

export async function orchestrateSearch(filters: SearchFilters): Promise<LiamResponse> {
  const command: LiamCommand = {
    action: "search",
    filters,
  };

  try {
    const result = await callLlm(
      `A user wants to search for leads with these filters: ${JSON.stringify(filters)}. ` +
        `Confirm the search parameters and suggest any optimizations.`,
    );

    return {
      success: true,
      data: {
        command,
        llmSuggestion: result,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function parseVoiceToFilters(transcript: string): Promise<SearchFilters> {
  return parseUserCommand(transcript);
}
