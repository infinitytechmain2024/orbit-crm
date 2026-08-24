import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Clock,
  CheckCircle,
  FileText,
  ExternalLink,
  RefreshCw,
  Bot,
  Database,
  AlertCircle,
  Save,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";
import { SkyscannerSearchPanel } from "@/components/search/SkyscannerSearchPanel";
import type { SearchFilters } from "@/types/search";
import { bulkCreateLeadClients, type LeadClientInput } from "@/lib/crm-repository";
import { useAuth } from "@/lib/auth";
import { useCrm } from "@/lib/crm-store";
import { toast } from "sonner";

export const Route = createFileRoute("/lead-search")({
  head: () => ({
    meta: [
      { title: "Lead Search — Orbit CRM" },
      {
        name: "description",
        content: "AI-powered lead generation with OpenManus + Liam",
      },
      { property: "og:title", content: "Lead Search — Orbit CRM" },
      { property: "og:description", content: "AI Lead Generation" },
      { property: "og:image", content: "/og-image.png" },
    ],
  }),
  component: LeadSearchPage,
});

const LEAD_GEN_API = import.meta.env.VITE_LEAD_GEN_URL || "http://localhost:8090";

interface SearchJob {
  job_id: string;
  status: "idle" | "running" | "completed" | "failed";
  leads_found: number;
  report_path: string | null;
  error: string | null;
  created_at: string | null;
}

interface LeadResult {
  company_name: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  location: string;
  category: string;
}

interface SystemStatus {
  ollama: { available: boolean; url: string };
  notion: { configured: boolean; database_set: boolean };
  gmaps: { available: boolean };
}

function LeadSearchPage() {
  const { user } = useAuth();
  const { organization } = useCrm();
  const [currentJob, setCurrentJob] = useState<SearchJob | null>(null);
  const [leads, setLeads] = useState<LeadResult[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFilters, setLastFilters] = useState<SearchFilters | null>(null);

  // Check system status
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${LEAD_GEN_API}/api/status`);
      if (res.ok) {
        setSystemStatus(await res.json());
      } else {
        toast.error("Ошибка подключения", {
          description: "Не удалось подключиться к серверу генерации лидов",
        });
      }
    } catch {
      setSystemStatus(null);
      toast.error("Сервис недоступен", {
        description: "Сервер генерации лидов не запущен на " + LEAD_GEN_API,
        action: {
          label: "Как запустить?",
          onClick: () =>
            window.open("https://github.com/your-repo/lead-generator#readme", "_blank"),
        },
      });
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Poll job status
  useEffect(() => {
    if (!currentJob || currentJob.status !== "running") return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${LEAD_GEN_API}/api/search/${currentJob.job_id}`);
        if (res.ok) {
          const data = await res.json();
          setCurrentJob(data);
          if (data.status === "completed" || data.status === "failed") {
            setIsSearching(false);
            if (data.status === "completed" && data.leads) {
              setLeads(data.leads);
            }
          }
        }
      } catch {
        // silently fail
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [currentJob]);

  const handleSearch = async (filters: SearchFilters) => {
    setError(null);
    setIsSearching(true);
    setLeads([]);
    setLastFilters(filters);

    try {
      const res = await fetch(`${LEAD_GEN_API}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          criteria: {
            industry: filters.niche,
            location: `${filters.city}, ${filters.country}`,
            company_size: "any",
            keywords: [],
            max_results: filters.leadLimit,
            website_status: filters.websiteStatus,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Search failed");
      }

      const data = await res.json();
      setCurrentJob({
        job_id: data.job_id,
        status: "running",
        leads_found: 0,
        report_path: null,
        error: null,
        created_at: new Date().toISOString(),
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Search failed");
      setIsSearching(false);
    }
  };

  const saveLeadsToSupabase = async () => {
    if (!user || leads.length === 0 || !lastFilters) return;

    setIsSaving(true);
    try {
      const inputs: LeadClientInput[] = leads.map((lead) => ({
        businessName: lead.company_name || "Unknown",
        category: lead.category || lastFilters.niche,
        cityLocation: lastFilters.city,
        country: lastFilters.country,
        countryFlag: lastFilters.countryFlag,
        contactPhone: lead.phone || null,
        email: lead.email || "-",
        websiteUrl: lead.website || "-",
        whatsappStatus: "Unverified",
        googleMapsUrl: null,
        priority: "Middle",
        status: "Lead",
        websiteStatusType: lead.website ? "good" : "no_website",
        sourceQuery: `${lastFilters.niche} in ${lastFilters.city}`,
      }));

      if (!organization) throw new Error("Organization is not available");
      await bulkCreateLeadClients(user.id, organization.id, inputs);
      alert(`Successfully saved ${inputs.length} leads to Supabase!`);
    } catch (e: unknown) {
      alert(`Failed to save leads: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppShell title="AI Lead Search" subtitle="Find potential clients with AI-powered search">
      <div className="space-y-6">
        {/* System Status Bar */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface-2/40 p-4">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-primary" />
            <span className="text-xs font-medium">System:</span>
          </div>
          <div className="flex items-center gap-1.5">
            {systemStatus?.ollama.available ? (
              <span className="flex items-center gap-1 rounded-full bg-badge-green-bg px-2 py-0.5 text-xs text-badge-green">
                <CheckCircle className="size-3" /> Llama 3.2
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-badge-red-bg px-2 py-0.5 text-xs text-badge-red">
                <AlertCircle className="size-3" /> Ollama offline
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {systemStatus?.notion?.configured ? (
              <span className="flex items-center gap-1 rounded-full bg-badge-green-bg px-2 py-0.5 text-xs text-badge-green">
                <Database className="size-3" /> Notion
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-badge-yellow-bg px-2 py-0.5 text-xs text-badge-yellow">
                <Database className="size-3" /> Notion not configured
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {systemStatus?.gmaps?.available ? (
              <span className="flex items-center gap-1 rounded-full bg-badge-green-bg px-2 py-0.5 text-xs text-badge-green">
                <CheckCircle className="size-3" /> Google Maps
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-badge-yellow-bg px-2 py-0.5 text-xs text-badge-yellow">
                <AlertCircle className="size-3" /> GMaps offline
              </span>
            )}
          </div>
          <button
            onClick={checkStatus}
            className="ml-auto rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>

        {/* Search Form */}
        <SkyscannerSearchPanel
          onSearch={handleSearch}
          isSearching={isSearching}
          initialFilters={lastFilters ?? undefined}
        />

        {/* Error Message */}
        {error && (
          <div className="rounded-xl border border-badge-red/30 bg-badge-red-bg p-4 text-sm text-badge-red">
            {error}
          </div>
        )}

        {/* Job Status */}
        {currentJob && currentJob.status === "running" && (
          <div className="rounded-xl border border-border bg-surface-2/40 p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4 animate-spin text-badge-blue" />
                Job #{currentJob.job_id.slice(0, 8)}
              </h3>
              <span className="rounded-full bg-badge-blue-bg px-2 py-0.5 text-xs font-medium text-badge-blue">
                Running
              </span>
            </div>
            <div className="space-y-3">
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
              </div>
              <p className="text-xs text-muted-foreground">
                AI agent is searching for potential clients...
              </p>
            </div>
          </div>
        )}

        {/* Results Section */}
        <div className="rounded-2xl border border-border bg-surface-2/60 p-6">
          <div className="mb-4 flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Results ({leads.length})</h3>
          </div>

          {leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 grid size-16 place-items-center rounded-full bg-surface-2/80">
                <Search className="size-7 text-muted-foreground/50" />
              </div>
              <h4 className="mb-1 text-sm font-medium">No leads found yet</h4>
              <p className="text-xs text-muted-foreground/60">
                Set filters and click Find Leads to start your search.
              </p>
            </div>
          ) : (
            <>
              {/* Save to Supabase Button */}
              <div className="mb-4 flex items-center justify-between rounded-xl border border-border bg-surface-2/40 p-4">
                <div>
                  <p className="text-sm font-medium">{leads.length} leads found</p>
                  <p className="text-xs text-muted-foreground">
                    Save these leads to your CRM database
                  </p>
                </div>
                <button
                  onClick={saveLeadsToSupabase}
                  disabled={isSaving || !user}
                  className={cn(
                    "flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition",
                    isSaving
                      ? "bg-primary/50 text-primary-foreground cursor-not-allowed"
                      : "bg-primary text-primary-foreground hover:bg-primary/90",
                  )}
                >
                  {isSaving ? (
                    <>
                      <Clock className="size-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="size-4" />
                      Save to Supabase
                    </>
                  )}
                </button>
              </div>

              {/* Leads Table */}
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-2/60">
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                          Business Name
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                          Category
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                          Contact
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                          Email
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                          Website
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {leads.map((lead, idx) => (
                        <tr key={idx} className="transition hover:bg-surface-2/40">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="grid size-8 place-items-center rounded-lg bg-primary/12 text-xs font-semibold text-primary">
                                {lead.company_name?.charAt(0) || "?"}
                              </div>
                              <span className="font-medium">{lead.company_name || "Unknown"}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {lead.category || "-"}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {lead.phone || "-"}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {lead.email || "-"}
                          </td>
                          <td className="px-4 py-3">
                            {lead.website ? (
                              <a
                                href={lead.website}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                <ExternalLink className="size-3" />
                                Visit
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
