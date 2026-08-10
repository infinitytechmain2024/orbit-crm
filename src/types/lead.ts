import type { Json } from "../lib/supabase/database.types";

export type LeadPriority = "High" | "Middle" | "Low";
export type LeadStatus = "Lead" | "New" | "In Progress" | "Rejected" | "Archived";
export type WebsiteStatus = "no_website" | "needs_upgrade" | "good";

export interface LeadClient {
  id: string;
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
  priority: LeadPriority;
  status: LeadStatus;
  websiteStatusType: WebsiteStatus | null;
  aiOfferScript: Json | null;
  sourceQuery: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadClientInput {
  businessName: string;
  category: string;
  cityLocation: string;
  country?: string;
  countryFlag?: string;
  contactPhone?: string | null;
  email?: string;
  websiteUrl?: string;
  whatsappStatus?: string;
  googleMapsUrl?: string | null;
  priority?: LeadPriority;
  status?: LeadStatus;
  websiteStatusType?: WebsiteStatus | null;
  aiOfferScript?: Json | null;
  sourceQuery?: string | null;
}

export type LeadClientPatch = Partial<LeadClientInput>;

export interface CityGroupedClients {
  cityLocation: string;
  clients: LeadClient[];
  clientCount: number;
}

export interface AiOfferScript {
  audit: string;
  proposal: string;
  callScript: string;
  weakPoints: string[];
  recommendations: string[];
}
