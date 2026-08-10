import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CityGroupHeader } from "./CityGroupHeader";
import { LeadRow } from "./LeadRow";
import type { LeadClient, CityGroupedClients, LeadStatus } from "@/types/lead";

interface NotionTableProps {
  groups: CityGroupedClients[];
  searchQuery: string;
  statusFilter: LeadStatus | "all";
  onLeadClick: (lead: LeadClient) => void;
  onStatusChange?: (id: string, status: LeadStatus) => void;
  className?: string;
}

export function NotionTable({
  groups,
  searchQuery,
  statusFilter,
  onLeadClick,
  onStatusChange,
  className,
}: NotionTableProps) {
  const [expandedCities, setExpandedCities] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<keyof LeadClient>("businessName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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
    setExpandedCities(new Set(groups.map((g) => g.cityLocation)));
  };

  const collapseAll = () => {
    setExpandedCities(new Set());
  };

  const toggleSort = (field: keyof LeadClient) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filteredGroups = groups
    .map((group) => {
      let filteredClients = group.clients;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filteredClients = filteredClients.filter(
          (c) =>
            c.businessName.toLowerCase().includes(q) ||
            c.category.toLowerCase().includes(q) ||
            c.email.toLowerCase().includes(q)
        );
      }

      if (statusFilter !== "all") {
        filteredClients = filteredClients.filter((c) => c.status === statusFilter);
      }

      filteredClients.sort((a, b) => {
        const aVal = a[sortField] ?? "";
        const bVal = b[sortField] ?? "";
        const cmp = String(aVal).localeCompare(String(bVal));
        return sortDir === "asc" ? cmp : -cmp;
      });

      return {
        ...group,
        clients: filteredClients,
        clientCount: filteredClients.length,
      };
    })
    .filter((g) => g.clientCount > 0);

  const totalLeads = filteredGroups.reduce((sum, g) => sum + g.clientCount, 0);

  const columns: { key: keyof LeadClient; label: string; width?: string }[] = [
    { key: "businessName", label: "Business Name" },
    { key: "category", label: "Category" },
    { key: "contactPhone", label: "Contact" },
    { key: "email", label: "Email" },
    { key: "websiteUrl", label: "Website" },
    { key: "whatsappStatus", label: "WhatsApp" },
    { key: "googleMapsUrl", label: "Maps" },
    { key: "priority", label: "Priority" },
    { key: "status", label: "Status" },
  ];

  return (
    <div className={cn("space-y-4", className)}>
      {/* Table Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {totalLeads} leads in {filteredGroups.length} cities
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground transition"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Column Headers */}
      <div className="flex items-center gap-0 rounded-t-xl border border-border bg-surface-2/80 px-4 py-2">
        <div className="w-8" />
        {columns.map((col) => (
          <button
            key={col.key}
            onClick={() => toggleSort(col.key)}
            className="flex items-center gap-1 px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition"
          >
            {col.label}
            {sortField === col.key && (
              <ChevronsUpDown className="size-3 text-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Groups */}
      {filteredGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface-2/40 py-16">
          <Search className="mb-3 size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No leads found</p>
        </div>
      ) : (
        filteredGroups.map((group) => (
          <div key={group.cityLocation} className="space-y-0">
            <CityGroupHeader
              city={group.cityLocation}
              count={group.clientCount}
              isExpanded={expandedCities.has(group.cityLocation)}
              onToggle={() => toggleCity(group.cityLocation)}
            />
            {expandedCities.has(group.cityLocation) && (
              <div className="rounded-b-xl border border-t-0 border-border">
                {group.clients.map((client) => (
                  <LeadRow
                    key={client.id}
                    client={client}
                    onClick={() => onLeadClick(client)}
                    onStatusChange={onStatusChange!}
                  />
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
