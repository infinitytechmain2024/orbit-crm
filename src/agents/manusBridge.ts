import type { SearchFilters } from "../types/search";
import type { ScrapingResult, ManusJobStatus } from "../types/agent";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const LEAD_GEN_API = import.meta.env.VITE_LEAD_GEN_URL || API_URL;
const BACKEND_API = API_URL;

const COMMON_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "ngrok-skip-browser-warning": "true",
};

interface SearchRequestPayload {
  city: string;
  niche: string;
  max_results: number;
  website_status?: string;
  country?: string;
}

interface SearchJobResponse {
  job_id: string;
  status: string;
  message: string;
}

interface SearchJobStatusResponse {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  leads_found: number;
  report_path: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
}

interface SystemStatusResponse {
  ollama: { available: boolean; url: string };
  playwright: { available: boolean };
  notion: { configured: boolean; database_set: boolean };
  reports_dir: string;
}

async function apiFetch<T>(
  base: string,
  path: string,
  options?: RequestInit
): Promise<T> {
  const url = `${base}${path}`;
  const response = await fetch(url, {
    headers: {
      ...COMMON_HEADERS,
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "Unknown error");
    throw new Error(
      `API error ${response.status} from ${url}: ${errorBody}`
    );
  }

  return response.json() as Promise<T>;
}

export async function startLeadSearch(
  filters: SearchFilters
): Promise<ManusJobStatus> {
  const payload: SearchRequestPayload = {
    city: filters.city,
    niche: filters.niche,
    max_results: filters.leadLimit,
    website_status: filters.websiteStatus,
    country: filters.country,
  };

  const data = await apiFetch<SearchJobResponse>(LEAD_GEN_API, "/api/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return {
    jobId: data.job_id,
    status: data.status as ManusJobStatus["status"],
    leadsFound: 0,
  };
}

export async function getJobStatus(
  jobId: string
): Promise<ManusJobStatus> {
  const data = await apiFetch<SearchJobStatusResponse>(
    LEAD_GEN_API,
    `/api/search/${jobId}`
  );

  return {
    jobId: data.job_id,
    status: data.status,
    leadsFound: data.leads_found,
    error: data.error ?? undefined,
    startedAt: data.started_at ?? undefined,
    completedAt: data.completed_at ?? undefined,
  } as ManusJobStatus;
}

export async function listSearchJobs(): Promise<ManusJobStatus[]> {
  const data = await apiFetch<{
    jobs: Array<{
      job_id: string;
      status: string;
      leads_found: number;
      report_path: string | null;
      created_at: string | null;
    }>;
  }>(LEAD_GEN_API, "/api/search");

  return data.jobs.map((j) => ({
    jobId: j.job_id,
    status: j.status as ManusJobStatus["status"],
    leadsFound: j.leads_found,
  }));
}

export async function scrapeSingleBusiness(
  url: string
): Promise<ScrapingResult> {
  const data = await apiFetch<ScrapingResult>(
    LEAD_GEN_API,
    "/api/scrape",
    {
      method: "POST",
      body: JSON.stringify({ url }),
    }
  );

  return data;
}

export async function getSystemStatus(): Promise<SystemStatusResponse> {
  return apiFetch<SystemStatusResponse>(LEAD_GEN_API, "/api/status");
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const data = await apiFetch<{ status: string }>(
      BACKEND_API,
      "/api/health"
    );
    return data.status === "ok";
  } catch {
    return false;
  }
}

export async function checkLeadGenHealth(): Promise<boolean> {
  try {
    const data = await apiFetch<{ status: string }>(
      LEAD_GEN_API,
      "/api/health"
    );
    return data.status === "ok";
  } catch {
    return false;
  }
}
