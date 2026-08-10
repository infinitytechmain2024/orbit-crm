import type { SearchFilters } from "./search";
import type { LeadClientInput } from "./lead";

export interface AgentTask {
  id: string;
  type: "scrape" | "analyze" | "generate_offer" | "generate_script";
  status: "pending" | "running" | "completed" | "failed";
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export interface ScrapingResult {
  businessName: string;
  category: string;
  cityLocation: string;
  country: string;
  countryFlag: string;
  contactPhone: string | null;
  email: string;
  websiteUrl: string;
  whatsappStatus: string;
  googleMapsUrl: string | null;
  websiteStatusType: "no_website" | "needs_upgrade" | "good";
  sourceQuery: string;
}

export interface LiamCommand {
  action: "search" | "analyze" | "generate_offer" | "generate_script";
  filters?: SearchFilters;
  leadId?: string;
  lead?: LeadClientInput;
  rawText?: string;
}

export interface LiamResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface ManusJobStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  leadsFound: number;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}
