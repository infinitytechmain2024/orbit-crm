import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  Phone,
  Mail,
  Search,
  Globe,
  MapPin,
  ExternalLink,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Star,
  Bot,
  Loader2,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  fetchLeadClientsGroupedByCity,
  type LeadClient,
  type CityGroupedClients,
} from "@/lib/crm-repository";
import { LeadDetailDrawer } from "@/components/drawer/LeadDetailDrawer";

export const Route = createFileRoute("/clients")({
  head: () => ({
    meta: [
      { title: "Clients — Orbit CRM" },
      {
        name: "description",
        content: "Manage your lead database with city-based grouping",
      },
      { property: "og:title", content: "Clients — Orbit CRM" },
      { property: "og:description", content: "Lead database management" },
      { property: "og:image", content: "/og-image.png" },
    ],
  }),
  component: ClientsPage,
});

const STATUS_CONFIG = {
  Lead: { color: "text-badge-blue", bg: "bg-badge-blue-bg" },
  New: { color: "text-badge-purple", bg: "bg-badge-purple-bg" },
  "In Progress": { color: "text-badge-yellow", bg: "bg-badge-yellow-bg" },
  Rejected: { color: "text-badge-red", bg: "bg-badge-red-bg" },
  Archived: { color: "text-badge-gray", bg: "bg-badge-gray-bg" },
};

const PRIORITY_CONFIG = {
  High: { color: "text-badge-red", bg: "bg-badge-red-bg" },
  Middle: { color: "text-badge-yellow", bg: "bg-badge-yellow-bg" },
  Low: { color: "text-badge-green", bg: "bg-badge-green-bg" },
};

function ClientsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [cityGroups, setCityGroups] = useState<CityGroupedClients[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set());
  const [selectedClient, setSelectedClient] = useState<LeadClient | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadClients = useCallback(async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const groups = await fetchLeadClientsGroupedByCity(
        user.id,
        statusFilter === "all" ? undefined : statusFilter,
      );
      setCityGroups(groups);

      // Auto-expand first 3 cities
      if (groups.length > 0) {
        const firstCities = new Set(groups.slice(0, 3).map((g) => g.cityLocation));
        setExpandedCities(firstCities);
      }
    } catch (error) {
      console.error("Failed to load clients:", error);
    } finally {
      setIsLoading(false);
    }
  }, [user, statusFilter]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const toggleCity = (city: string) => {
    setExpandedCities((prev) => {
      const next = new Set(prev);
      if (next.has(city)) {
        next.delete(city);
      } else {
        next.add(city);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedCities(new Set(cityGroups.map((g) => g.cityLocation)));
  };

  const collapseAll = () => {
    setExpandedCities(new Set());
  };

  const openClientDrawer = (client: LeadClient) => {
    setSelectedClient(client);
    setDrawerOpen(true);
  };

  const closeClientDrawer = () => {
    setDrawerOpen(false);
    setSelectedClient(null);
  };

  // Filter clients by search
  const filteredGroups = cityGroups
    .map((group) => ({
      ...group,
      clients: group.clients.filter(
        (c) =>
          c.businessName.toLowerCase().includes(search.toLowerCase()) ||
          c.category.toLowerCase().includes(search.toLowerCase()) ||
          c.email.toLowerCase().includes(search.toLowerCase()),
      ),
    }))
    .filter((group) => group.clients.length > 0);

  const totalClients = filteredGroups.reduce((sum, g) => sum + g.clients.length, 0);

  return (
    <AppShell title="Clients" subtitle="Lead database with city-based grouping">
      <div className="space-y-6">
        {/* Search and Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by business name, category, or email..."
              className="w-full rounded-xl border border-border bg-surface-2/60 py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-primary/60"
            />
          </div>
          <div className="flex gap-1 rounded-xl border border-border bg-surface-2/40 p-1">
            {[
              { id: "all", label: "All" },
              { id: "Lead", label: "Leads" },
              { id: "New", label: "New" },
              { id: "In Progress", label: "In Progress" },
              { id: "Rejected", label: "Rejected" },
            ].map((status) => (
              <button
                key={status.id}
                onClick={() => setStatusFilter(status.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                  statusFilter === status.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {status.label}
              </button>
            ))}
          </div>
        </div>

        {/* City Groups Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">
              {filteredGroups.length} {filteredGroups.length === 1 ? "City" : "Cities"}
            </h2>
            <span className="text-xs text-muted-foreground">({totalClients} total clients)</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={expandAll}
              className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-2/20 p-12 text-center">
            <MapPin className="mb-4 size-12 text-muted-foreground/40" />
            <h3 className="text-sm font-medium text-muted-foreground">
              {search || statusFilter !== "all"
                ? "No clients match your filters"
                : "No clients yet"}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground/60">
              {search || statusFilter !== "all"
                ? "Try adjusting your search or filters"
                : "Go to Lead Search to find potential clients"}
            </p>
          </div>
        )}

        {/* City Groups */}
        {!isLoading && filteredGroups.length > 0 && (
          <div className="space-y-4">
            {filteredGroups.map((group) => {
              const isExpanded = expandedCities.has(group.cityLocation);
              return (
                <div
                  key={group.cityLocation}
                  className="overflow-hidden rounded-xl border border-border"
                >
                  {/* City Header */}
                  <button
                    onClick={() => toggleCity(group.cityLocation)}
                    className="flex w-full items-center justify-between bg-surface-2/60 px-4 py-3 transition hover:bg-surface-2/80"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="size-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" />
                      )}
                      <MapPin className="size-4 text-primary" />
                      <span className="text-sm font-semibold">{group.cityLocation}</span>
                      <span className="rounded-full bg-primary/12 px-2 py-0.5 text-xs font-medium text-primary">
                        {group.clientCount}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {group.clients.some((c) => c.priority === "High") && (
                        <span className="flex items-center gap-1 rounded-full bg-badge-red-bg px-2 py-0.5 text-xs text-badge-red">
                          <Star className="size-3" />
                          {group.clients.filter((c) => c.priority === "High").length} High
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Clients Table */}
                  {isExpanded && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-surface-2/40">
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                              Business Name
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                              Category
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                              Contact
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                              Email
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                              Website
                            </th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                              WhatsApp
                            </th>
                            <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">
                              Priority
                            </th>
                            <th className="px-4 py-2.5 text-center text-xs font-medium text-muted-foreground">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {group.clients.map((client) => {
                            const statusCfg = STATUS_CONFIG[client.status];
                            const priorityCfg = PRIORITY_CONFIG[client.priority];
                            return (
                              <tr
                                key={client.id}
                                className="cursor-pointer transition hover:bg-surface-2/40"
                                onClick={() => openClientDrawer(client)}
                              >
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="grid size-8 place-items-center rounded-lg bg-primary/12 text-xs font-semibold text-primary">
                                      {client.businessName.charAt(0)}
                                    </div>
                                    <span className="font-medium">{client.businessName}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-xs text-muted-foreground">
                                  {client.category}
                                </td>
                                <td className="px-4 py-3">
                                  {client.contactPhone && client.contactPhone !== "-" ? (
                                    <a
                                      href={`tel:${client.contactPhone}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                    >
                                      <Phone className="size-3" />
                                      {client.contactPhone}
                                    </a>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {client.email && client.email !== "-" ? (
                                    <a
                                      href={`mailto:${client.email}`}
                                      onClick={(e) => e.stopPropagation()}
                                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                    >
                                      <Mail className="size-3" />
                                      {client.email}
                                    </a>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {client.websiteUrl && client.websiteUrl !== "-" ? (
                                    <a
                                      href={client.websiteUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="flex items-center gap-1 text-xs text-primary hover:underline"
                                    >
                                      <Globe className="size-3" />
                                      Visit
                                    </a>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">-</span>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                                      client.whatsappStatus === "Verified"
                                        ? "bg-badge-green-bg text-badge-green"
                                        : client.whatsappStatus === "Not Available"
                                          ? "bg-badge-red-bg text-badge-red"
                                          : "bg-badge-yellow-bg text-badge-yellow",
                                    )}
                                  >
                                    <MessageSquare className="size-3" />
                                    {client.whatsappStatus}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                                      priorityCfg.bg,
                                      priorityCfg.color,
                                    )}
                                  >
                                    <Star className="size-3" />
                                    {client.priority}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <span
                                    className={cn(
                                      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                      statusCfg.bg,
                                      statusCfg.color,
                                    )}
                                  >
                                    {client.status}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Lead Detail Drawer */}
        <LeadDetailDrawer client={selectedClient} isOpen={drawerOpen} onClose={closeClientDrawer} />
      </div>
    </AppShell>
  );
}
