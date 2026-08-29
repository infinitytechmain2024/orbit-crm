import type { SearchFilters } from "../types/search";
import type { ScrapingResult } from "../types/agent";

const API_URL = import.meta.env["VITE_API_URL"] || "https://aura-crm-hn11.onrender.com";

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "ngrok-skip-browser-warning": "true",
};

interface LeadSearchResponse {
  leads: Array<{
    id: string;
    business_name: string;
    address: string;
    phone: string;
    email: string;
    website: string;
    category: string;
    rating: number;
    reviews: number;
    source: string;
    google_maps_url: string;
  }>;
  total: number;
  query: {
    niche: string;
    city: string;
    country: string;
    limit: number;
  };
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  const response = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(`API error ${response.status} from ${url}: ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

export async function startLeadSearch(filters: SearchFilters): Promise<LeadSearchResponse> {
  return apiFetch<LeadSearchResponse>("/api/lead-search", {
    method: "POST",
    body: JSON.stringify({
      state: filters.state,
      niche: filters.niche,
      city: filters.city,
      country: filters.country,
      countryFlag: filters.countryFlag,
      websiteStatus: filters.websiteStatus,
      limit: filters.leadLimit,
    }),
  });
}

export async function scrapeSingleBusiness(url: string): Promise<ScrapingResult> {
  const data = await apiFetch<ScrapingResult>("/api/scrape", {
    method: "POST",
    body: JSON.stringify({ url }),
  });

  return data;
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const data = await apiFetch<{ status: string }>("/api/health");
    return data.status === "ok";
  } catch {
    return false;
  }
}
