import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Clock,
  CheckCircle,
  XCircle,
  FileText,
  ExternalLink,
  RefreshCw,
  Bot,
  Database,
  AlertCircle,
  Save,
  Sparkles,
  Wand2,
  MousePointerClick,
  Loader2,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";
import { SkyscannerSearchPanel } from "@/components/search/SkyscannerSearchPanel";
import { VoiceRecorder } from "@/components/voice/VoiceRecorder";
import type { SearchFilters } from "@/types/search";
import { DEFAULT_SEARCH_FILTERS } from "@/types/search";
import {
  bulkCreateLeadClients,
  type LeadClientInput,
} from "@/lib/crm-repository";
import { useAuth } from "@/lib/auth";
import { parseVoiceToFilters } from "@/agents/liam";

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

const LEAD_GEN_API = "http://localhost:8090";

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
}

function LeadSearchPage() {
  const { user } = useAuth();
  const [currentJob, setCurrentJob] = useState<SearchJob | null>(null);
  const [leads, setLeads] = useState<LeadResult[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"search" | "results">("search");
  const [lastFilters, setLastFilters] = useState<SearchFilters | null>(null);

  // Voice search state
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [searchMode, setSearchMode] = useState<"manual" | "ai">("manual");
  const [parsingVoice, setParsingVoice] = useState(false);

  // Check system status
  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${LEAD_GEN_API}/api/status`);
      if (res.ok) {
        setSystemStatus(await res.json());
      }
    } catch {
      setSystemStatus(null);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  // Voice transcript handler
  const handleVoiceTranscript = useCallback(async (transcript: string) => {
    setVoiceTranscript(transcript);
    setParsingVoice(true);
    try {
      const filters = await parseVoiceToFilters(transcript);
      setLastFilters(filters);
      handleSearch(filters);
    } catch (err) {
      console.error("Failed to parse voice filters:", err);
    } finally {
      setParsingVoice(false);
    }
  }, []);

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
              setActiveTab("results");
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
        country: "United States",
        countryFlag: "🇺🇸",
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

      await bulkCreateLeadClients(user.id, inputs);
      alert(`Successfully saved ${inputs.length} leads to Supabase!`);
    } catch (e: unknown) {
      alert(`Failed to save leads: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "running":
        return <Clock className="size-4 animate-spin text-blue-400" />;
      case "completed":
        return <CheckCircle className="size-4 text-green-400" />;
      case "failed":
        return <XCircle className="size-4 text-red-400" />;
      default:
        return <Clock className="size-4 text-muted-foreground" />;
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
              <span className="flex items-center gap-1 rounded-full bg-green-400/12 px-2 py-0.5 text-xs text-green-400">
                <CheckCircle className="size-3" /> Llama 3.2
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-red-400/12 px-2 py-0.5 text-xs text-red-400">
                <AlertCircle className="size-3" /> Ollama offline
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {systemStatus?.notion?.configured ? (
              <span className="flex items-center gap-1 rounded-full bg-green-400/12 px-2 py-0.5 text-xs text-green-400">
                <Database className="size-3" /> Notion
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full bg-yellow-400/12 px-2 py-0.5 text-xs text-yellow-400">
                <Database className="size-3" /> Notion not configured
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

        {/* Tabs */}
        <div className="flex gap-1 rounded-xl border border-border bg-surface-2/40 p-1">
          <button
            onClick={() => setActiveTab("search")}
            className={cn(
              "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition",
              activeTab === "search"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Search className="mr-2 inline size-4" />
            New Search
          </button>
          <button
            onClick={() => setActiveTab("results")}
            disabled={leads.length === 0}
            className={cn(
              "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition",
              activeTab === "results"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
              leads.length === 0 && "opacity-50 cursor-not-allowed",
            )}
          >
            <FileText className="mr-2 inline size-4" />
            Results ({leads.length})
          </button>
        </div>

        {/* Search Tab */}
        {activeTab === "search" && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left Panel: Mode Toggle + Controls */}
            <div className="lg:col-span-1 space-y-4">
              {/* Mode Toggle */}
              <div className="flex gap-1 rounded-xl border border-border bg-surface-2/40 p-1">
                <button
                  onClick={() => setSearchMode("manual")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
                    searchMode === "manual"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <MousePointerClick className="size-4" />
                  Manual
                </button>
                <button
                  onClick={() => setSearchMode("ai")}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
                    searchMode === "ai"
                      ? "bg-purple-500 text-white"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Wand2 className="size-4" />
                  AI Voice
                </button>
              </div>

              {searchMode === "manual" ? (
                <SkyscannerSearchPanel
                  onSearch={handleSearch}
                  isSearching={isSearching}
                  initialFilters={lastFilters ?? undefined}
                />
              ) : (
                <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-6">
                  <div className="mb-4 flex items-center gap-2">
                    <Sparkles className="size-4 text-purple-400" />
                    <h3 className="text-sm font-semibold">Voice Search</h3>
                  </div>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Say something like: "Find 15 cleaning companies without websites in Austin"
                  </p>

                  <VoiceRecorder
                    onTranscript={handleVoiceTranscript}
                    onError={(err) => setError(err)}
                  />

                  {parsingVoice && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-purple-400">
                      <Loader2 className="size-3 animate-spin" />
                      Liam is parsing your request...
                    </div>
                  )}

                  {voiceTranscript && !parsingVoice && (
                    <div className="mt-3 rounded-xl border border-purple-500/30 bg-purple-500/10 p-3">
                      <p className="mb-1 text-xs font-medium text-purple-400">Transcript:</p>
                      <p className="text-sm text-foreground">"{voiceTranscript}"</p>
                      {lastFilters && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {lastFilters.city && (
                            <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-300">
                              {lastFilters.city}
                            </span>
                          )}
                          {lastFilters.niche && (
                            <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-300">
                              {lastFilters.niche}
                            </span>
                          )}
                          <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-300">
                            {lastFilters.leadLimit} leads
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Job Status / Results Preview */}
            <div className="lg:col-span-2">
              {currentJob ? (
                <div className="rounded-xl border border-border bg-surface-2/40 p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      {statusIcon(currentJob.status)}
                      Job #{currentJob.job_id.slice(0, 8)}
                    </h3>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        currentJob.status === "running" && "bg-blue-400/12 text-blue-400",
                        currentJob.status === "completed" && "bg-green-400/12 text-green-400",
                        currentJob.status === "failed" && "bg-red-400/12 text-red-400",
                      )}
                    >
                      {currentJob.status === "running"
                        ? "Running"
                        : currentJob.status === "completed"
                          ? "Completed"
                          : "Failed"}
                    </span>
                  </div>

                  {currentJob.status === "running" && (
                    <div className="space-y-3">
                      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        AI agent is searching for potential clients...
                      </p>
                    </div>
                  )}

                  {currentJob.status === "completed" && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                        <div className="rounded-lg border border-border bg-surface-2/60 p-3 text-center">
                          <p className="text-2xl font-bold text-primary">
                            {currentJob.leads_found}
                          </p>
                          <p className="text-xs text-muted-foreground">Leads Found</p>
                        </div>
                        <div className="rounded-lg border border-border bg-surface-2/60 p-3 text-center">
                          <p className="text-2xl font-bold text-green-400">
                            {currentJob.report_path ? "✓" : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">Report</p>
                        </div>
                        <div className="rounded-lg border border-border bg-surface-2/60 p-3 text-center">
                          <p className="text-2xl font-bold text-purple-400">
                            {currentJob.created_at
                              ? new Date(currentJob.created_at).toLocaleTimeString("en-US", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">Start Time</p>
                        </div>
                      </div>

                      {currentJob.report_path && (
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={`${LEAD_GEN_API}/api/reports/${currentJob.report_path.split("/").pop()}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-xs font-medium transition hover:border-primary/50 hover:bg-surface-2"
                          >
                            <FileText className="size-3.5" />
                            Open Report
                            <ExternalLink className="size-3" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  {currentJob.status === "failed" && (
                    <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-400">
                      {currentJob.error || "An error occurred during search"}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-2/20 p-12 text-center">
                  <Bot className="mb-4 size-12 text-muted-foreground/40" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Results Tab */}
        {activeTab === "results" && (
          <div className="space-y-4">
            {leads.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-2/20 p-12 text-center">
                <FileText className="mb-4 size-12 text-muted-foreground/40" />
                <h3 className="text-sm font-medium text-muted-foreground">No results yet</h3>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Run a search to find potential clients
                </p>
              </div>
            ) : (
              <>
                {/* Save to Supabase Button */}
                <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/40 p-4">
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
                                <span className="font-medium">
                                  {lead.company_name || "Unknown"}
                                </span>
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
        )}
      </div>
    </AppShell>
  );
}
