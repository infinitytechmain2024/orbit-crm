import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useRef } from "react";
import {
  Search,
  Clock,
  CheckCircle,
  ExternalLink,
  RefreshCw,
  Bot,
  AlertCircle,
  Save,
  Download,
  Trash2,
  X,
  MapPin,
  Globe,
  Mail,
  Phone,
  Star,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";
import { SkyscannerSearchPanel } from "@/components/search/SkyscannerSearchPanel";
import type { SearchFilters } from "@/types/search";
import { bulkCreateLeadClients, type LeadClientInput } from "@/lib/crm-repository";
import { useAuth } from "@/lib/auth";
import { useCrm } from "@/lib/crm-store";
import { getSupabaseClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/lead-search")({
  head: () => ({
    meta: [
      { title: "Lead Search — Orbit CRM" },
      {
        name: "description",
        content: "AI-powered lead generation with Google Maps + OpenManus",
      },
      { property: "og:title", content: "Lead Search — Orbit CRM" },
      { property: "og:description", content: "AI Lead Generation" },
      { property: "og:image", content: "/og-image.png" },
    ],
  }),
  component: LeadSearchPage,
});

interface LeadResult {
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
}

interface SearchStage {
  label: string;
  progress: number;
}

const SEARCH_STAGES: SearchStage[] = [
  { label: "Geocoding location...", progress: 10 },
  { label: "Searching Google Maps...", progress: 30 },
  { label: "Found businesses, enriching data...", progress: 60 },
  { label: "Scraping websites for contacts...", progress: 80 },
  { label: "Finalizing results...", progress: 95 },
];

interface SavedSearch {
  id: string;
  name: string;
  query_niche: string;
  query_city: string;
  query_country: string;
  query_limit: number;
  total_found: number;
  created_at: string;
  results: LeadResult[];
}

function LeadSearchPage() {
  const { user } = useAuth();
  const { organization } = useCrm();
  const [leads, setLeads] = useState<LeadResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStage, setCurrentStage] = useState<SearchStage | null>(null);
  const [lastFilters, setLastFilters] = useState<SearchFilters | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadSavedSearches = useCallback(async () => {
    if (!user || !organization) return;
    setIsLoadingSaved(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error: dbError } = await supabase
        .from("saved_searches" as never)
        .select("*")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false })
        .limit(20);

      if (dbError) throw dbError;
      setSavedSearches((data as unknown as SavedSearch[]) || []);
    } catch (e) {
      console.error("Failed to load saved searches:", e);
    } finally {
      setIsLoadingSaved(false);
    }
  }, [user, organization]);

  const handleSearch = async (filters: SearchFilters) => {
    setError(null);
    setIsSearching(true);
    setLeads([]);
    setLastFilters(filters);
    setCurrentStage(SEARCH_STAGES[0] ?? null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      for (let i = 0; i < SEARCH_STAGES.length - 1; i++) {
        if (controller.signal.aborted) break;
        setCurrentStage(SEARCH_STAGES[i] ?? null);
        await new Promise((r) => setTimeout(r, 300));
      }

      if (controller.signal.aborted) {
        setIsSearching(false);
        setCurrentStage(null);
        return;
      }

      setCurrentStage(SEARCH_STAGES[SEARCH_STAGES.length - 1] ?? null);

      const res = await fetch("/api/lead-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: filters.niche,
          city: filters.city,
          country: filters.country,
          limit: filters.leadLimit,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Search failed (${res.status})`);
      }

      const data = await res.json();
      setLeads(data.leads || []);
      setCurrentStage({ label: "Complete!", progress: 100 });

      if (data.leads?.length > 0) {
        toast.success(`Found ${data.leads.length} leads`);
      } else {
        toast.info("No leads found for this query. Try different filters.");
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        toast.info("Search cancelled");
      } else {
        const msg = e instanceof Error ? e.message : "Search failed";
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setIsSearching(false);
      abortControllerRef.current = null;
      setTimeout(() => setCurrentStage(null), 2000);
    }
  };

  const handleCancel = () => {
    abortControllerRef.current?.abort();
    setIsSearching(false);
    setCurrentStage(null);
  };

  const saveToSupabase = async () => {
    if (!user || !organization || leads.length === 0 || !lastFilters) return;
    setIsSaving(true);
    try {
      const name = `${lastFilters.niche} in ${lastFilters.city} — ${new Date().toLocaleDateString()}`;

      const supabase = getSupabaseClient();
      const { error: dbError } = await supabase.from("saved_searches" as never).insert({
        organization_id: organization.id,
        user_id: user.id,
        name,
        query_niche: lastFilters.niche,
        query_city: lastFilters.city,
        query_country: lastFilters.country,
        query_limit: lastFilters.leadLimit,
        results: leads,
        total_found: leads.length,
      } as never);

      if (dbError) throw dbError;
      toast.success("Search results saved");

      const inputs: LeadClientInput[] = leads.map((lead) => ({
        businessName: lead.business_name || "Unknown",
        category: lead.category || lastFilters.niche,
        cityLocation: lastFilters.city,
        country: lastFilters.country,
        countryFlag: lastFilters.countryFlag,
        contactPhone: lead.phone || null,
        email: lead.email || "-",
        websiteUrl: lead.website || "-",
        whatsappStatus: "Unverified",
        googleMapsUrl: lead.google_maps_url || null,
        priority: "Middle",
        status: "Lead",
        websiteStatusType: lead.website ? "good" : "no_website",
        sourceQuery: `${lastFilters.niche} in ${lastFilters.city}`,
      }));

      await bulkCreateLeadClients(user.id, organization.id, inputs);
      toast.success(`Saved ${inputs.length} leads to CRM`);
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : "Unknown error"}`);
    } finally {
      setIsSaving(false);
    }
  };

  const loadSavedSearch = (saved: SavedSearch) => {
    setLeads(saved.results || []);
    setLastFilters({
      country: saved.query_country,
      countryFlag: "",
      city: saved.query_city,
      state: "",
      niche: saved.query_niche,
      websiteStatus: "all",
      leadLimit: saved.query_limit || 20,
    });
    setCurrentStage({ label: "Loaded from saved search", progress: 100 });
    toast.info(`Loaded ${saved.results?.length || 0} leads from "${saved.name}"`);
  };

  const deleteSavedSearch = async (id: string) => {
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("saved_searches" as never)
        .delete()
        .eq("id", id);
      if (error) throw error;
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
      toast.success("Deleted");
    } catch (e) {
      toast.error("Failed to delete");
    }
  };

  const exportCsv = () => {
    if (leads.length === 0) return;
    const headers = [
      "Business Name",
      "Address",
      "Phone",
      "Email",
      "Website",
      "Category",
      "Rating",
      "Reviews",
      "Source",
      "Maps URL",
    ];
    const rows = leads.map((l) => [
      l.business_name,
      l.address,
      l.phone,
      l.email,
      l.website,
      l.category,
      String(l.rating),
      String(l.reviews),
      l.source,
      l.google_maps_url,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${lastFilters?.niche || "search"}-${lastFilters?.city || ""}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  return (
    <AppShell title="AI Lead Search" subtitle="Find potential clients with Google Maps + OpenManus">
      <div className="space-y-6">
        {/* Search Form */}
        <SkyscannerSearchPanel
          onSearch={handleSearch}
          isSearching={isSearching}
          initialFilters={lastFilters ?? undefined}
        />

        {/* Cancel Button */}
        {isSearching && (
          <div className="flex justify-center">
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 rounded-xl border border-badge-red/30 bg-badge-red-bg px-4 py-2 text-sm font-medium text-badge-red transition hover:bg-badge-red/10"
            >
              <X className="size-4" />
              Cancel Search
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-badge-red/30 bg-badge-red-bg p-4 text-sm text-badge-red">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Progress Bar */}
        {currentStage && (
          <div className="rounded-xl border border-border bg-surface-2/40 p-6">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                {isSearching ? (
                  <Clock className="size-4 animate-spin text-badge-blue" />
                ) : currentStage.progress === 100 ? (
                  <CheckCircle className="size-4 text-badge-green" />
                ) : (
                  <Clock className="size-4 text-muted-foreground" />
                )}
                {currentStage.label}
              </h3>
              <span className="text-xs font-medium text-muted-foreground">
                {currentStage.progress}%
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  currentStage.progress === 100 ? "bg-badge-green" : "bg-primary",
                )}
                style={{ width: `${currentStage.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions Bar */}
        {leads.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-2/40 p-4">
            <span className="text-sm font-medium">{leads.length} leads found</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={exportCsv}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-surface-2"
              >
                <Download className="size-3.5" />
                Export CSV
              </button>
              <button
                onClick={saveToSupabase}
                disabled={isSaving || !user}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                  isSaving
                    ? "bg-primary/50 text-primary-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {isSaving ? (
                  <>
                    <Clock className="size-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="size-3.5" />
                    Save to CRM
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Results Table */}
        {leads.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2/60">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Business Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Address
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Phone
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Website
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Category
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Rating
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Source
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {leads.map((lead) => (
                    <tr key={lead.id} className="transition hover:bg-surface-2/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="grid size-8 place-items-center rounded-lg bg-primary/12 text-xs font-semibold text-primary">
                            {lead.business_name?.charAt(0) || "?"}
                          </div>
                          <div>
                            <span className="font-medium">{lead.business_name || "Unknown"}</span>
                            {lead.google_maps_url && (
                              <a
                                href={lead.google_maps_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="ml-1.5 inline-flex items-center text-xs text-primary hover:underline"
                              >
                                <MapPin className="size-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-3 text-xs text-muted-foreground">
                        {lead.address || "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {lead.phone ? (
                          <a
                            href={`tel:${lead.phone}`}
                            className="flex items-center gap-1 hover:text-primary"
                          >
                            <Phone className="size-3" />
                            {lead.phone}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {lead.email ? (
                          <a
                            href={`mailto:${lead.email}`}
                            className="flex items-center gap-1 hover:text-primary"
                          >
                            <Mail className="size-3" />
                            {lead.email}
                          </a>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {lead.website ? (
                          <a
                            href={
                              lead.website.startsWith("http")
                                ? lead.website
                                : `https://${lead.website}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Globe className="size-3" />
                            Visit
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {lead.category || "-"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {lead.rating > 0 ? (
                          <span className="flex items-center gap-1">
                            <Star className="size-3 fill-yellow-400 text-yellow-400" />
                            {lead.rating}
                            {lead.reviews > 0 && (
                              <span className="text-muted-foreground">({lead.reviews})</span>
                            )}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                            lead.source === "google_maps"
                              ? "bg-badge-green-bg text-badge-green"
                              : "bg-badge-blue-bg text-badge-blue",
                          )}
                        >
                          {lead.source === "google_maps" ? "GMaps" : "OSM"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Empty State */}
        {leads.length === 0 && !isSearching && !currentStage && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 grid size-16 place-items-center rounded-full bg-surface-2/80">
              <Bot className="size-7 text-muted-foreground/50" />
            </div>
            <h4 className="mb-1 text-sm font-medium">Ready to find leads</h4>
            <p className="text-xs text-muted-foreground/60">
              Set niche and city, then click Find Leads to start.
            </p>
          </div>
        )}

        {/* Saved Searches */}
        <div className="rounded-xl border border-border bg-surface-2/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Saved Searches</h3>
            <button
              onClick={loadSavedSearches}
              disabled={isLoadingSaved || !user}
              className="flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <RefreshCw className={cn("size-3", isLoadingSaved && "animate-spin")} />
              {savedSearches.length === 0 ? "Load" : "Refresh"}
            </button>
          </div>
          {savedSearches.length === 0 ? (
            <p className="text-xs text-muted-foreground/60">
              No saved searches yet. Run a search and save results to see them here.
            </p>
          ) : (
            <div className="space-y-2">
              {savedSearches.map((saved) => (
                <div
                  key={saved.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2 transition hover:bg-surface-2/60"
                >
                  <button onClick={() => loadSavedSearch(saved)} className="flex-1 text-left">
                    <div className="text-xs font-medium">{saved.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {saved.total_found} leads &middot;{" "}
                      {new Date(saved.created_at).toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteSavedSearch(saved.id)}
                    className="rounded p-1 text-muted-foreground transition hover:bg-badge-red-bg hover:text-badge-red"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
