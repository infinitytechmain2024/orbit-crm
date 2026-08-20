import {
  Phone,
  Mail,
  Globe,
  MapPin,
  Copy,
  ExternalLink,
  Star,
  Check,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import type { LeadClient, LeadStatus } from "@/types/lead";

interface LeadRowProps {
  client: LeadClient;
  onClick: () => void;
  onStatusChange?: (id: string, status: LeadStatus) => void;
}

const PRIORITY_BADGES = {
  High: "bg-badge-red-bg text-badge-red",
  Middle: "bg-badge-yellow-bg text-badge-yellow",
  Low: "bg-badge-green-bg text-badge-green",
};

const STATUS_BADGES: Record<LeadStatus, string> = {
  Lead: "bg-badge-blue-bg text-badge-blue",
  New: "bg-badge-purple-bg text-badge-purple",
  "In Progress": "bg-badge-orange-bg text-badge-orange",
  Rejected: "bg-badge-red-bg text-badge-red",
  Archived: "bg-badge-gray-bg text-badge-gray",
};

export function LeadRow({ client, onClick, onStatusChange }: LeadRowProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = async (text: string, field: string) => {
    if (!text || text === "-") return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // Fallback
    }
  };

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-0 border-b border-border px-4 py-3 cursor-pointer transition hover:bg-surface-2/40 last:border-b-0"
    >
      {/* Business Name */}
      <div className="w-[180px] truncate px-3 text-sm font-medium">
        {client.businessName}
      </div>

      {/* Category */}
      <div className="w-[120px] truncate px-3 text-xs text-muted-foreground">
        {client.category}
      </div>

      {/* Contact */}
      <div className="w-[130px] px-3">
        {client.contactPhone ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(client.contactPhone!, "phone");
            }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
          >
            {copiedField === "phone" ? (
              <Check className="size-3 text-badge-green" />
            ) : (
              <Copy className="size-3" />
            )}
            <span className="truncate">{client.contactPhone}</span>
          </button>
        ) : (
          <span className="text-xs text-muted-foreground/50">-</span>
        )}
      </div>

      {/* Email */}
      <div className="w-[140px] px-3">
        {client.email && client.email !== "-" ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              copyToClipboard(client.email, "email");
            }}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
          >
            {copiedField === "email" ? (
              <Check className="size-3 text-badge-green" />
            ) : (
              <Copy className="size-3" />
            )}
            <span className="truncate">{client.email}</span>
          </button>
        ) : (
          <span className="text-xs text-muted-foreground/50">-</span>
        )}
      </div>

      {/* Website */}
      <div className="w-[100px] px-3">
        {client.websiteUrl && client.websiteUrl !== "-" ? (
          <a
            href={client.websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition"
          >
            <ExternalLink className="size-3" />
            <span className="truncate">Site</span>
          </a>
        ) : (
          <span className="text-xs text-muted-foreground/50">-</span>
        )}
      </div>

      {/* WhatsApp */}
      <div className="w-[90px] px-3">
        <span
          className={cn(
            "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
            client.whatsappStatus === "Verified"
              ? "bg-badge-green-bg text-badge-green"
              : "bg-badge-gray-bg text-badge-gray"
          )}
        >
          {client.whatsappStatus}
        </span>
      </div>

      {/* Google Maps */}
      <div className="w-[60px] px-3">
        {client.googleMapsUrl ? (
          <a
            href={client.googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
          >
            <MapPin className="size-3" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground/50">-</span>
        )}
      </div>

      {/* Priority */}
      <div className="w-[80px] px-3">
        <span
          className={cn(
            "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
            PRIORITY_BADGES[client.priority]
          )}
        >
          {client.priority}
        </span>
      </div>

      {/* Status */}
      <div className="w-[100px] px-3">
        <span
          className={cn(
            "inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
            STATUS_BADGES[client.status]
          )}
        >
          {client.status}
        </span>
      </div>
    </div>
  );
}
