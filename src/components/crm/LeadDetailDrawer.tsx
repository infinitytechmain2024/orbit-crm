import { useState } from "react";
import {
  X,
  Phone,
  Mail,
  Globe,
  MapPin,
  Copy,
  ExternalLink,
  MessageSquare,
  Bot,
  FileText,
  Check,
  AlertTriangle,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadClient } from "@/lib/crm-repository";

interface LeadDetailDrawerProps {
  client: LeadClient | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: (id: string, patch: Partial<LeadClient>) => void;
}

const PRIORITY_CONFIG = {
  High: { color: "text-badge-red", bg: "bg-badge-red-bg", icon: Star },
  Middle: { color: "text-badge-yellow", bg: "bg-badge-yellow-bg", icon: Star },
  Low: { color: "text-badge-green", bg: "bg-badge-green-bg", icon: Star },
};

const STATUS_CONFIG = {
  Lead: { color: "text-badge-blue", bg: "bg-badge-blue-bg" },
  New: { color: "text-badge-purple", bg: "bg-badge-purple-bg" },
  "In Progress": { color: "text-badge-yellow", bg: "bg-badge-yellow-bg" },
  Rejected: { color: "text-badge-red", bg: "bg-badge-red-bg" },
  Archived: { color: "text-badge-gray", bg: "bg-badge-gray-bg" },
};

export function LeadDetailDrawer({ client, isOpen, onClose, onUpdate }: LeadDetailDrawerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [aiOffer, setAiOffer] = useState<string>(
    client?.aiOfferScript
      ? typeof client.aiOfferScript === "object"
        ? JSON.stringify(client.aiOfferScript, null, 2)
        : String(client.aiOfferScript)
      : "",
  );

  if (!isOpen || !client) return null;

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const priorityConfig = PRIORITY_CONFIG[client.priority];
  const statusConfig = STATUS_CONFIG[client.status];

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/50 transition-opacity" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-full w-full max-w-lg overflow-y-auto border-l border-border bg-surface-1 shadow-2xl transition-transform">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-border bg-surface-1/95 backdrop-blur-sm">
          <div className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-primary/12 text-sm font-bold text-primary">
                {client.businessName.charAt(0)}
              </div>
              <div>
                <h2 className="text-base font-semibold">{client.businessName}</h2>
                <p className="text-xs text-muted-foreground">{client.category}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Status & Priority */}
          <div className="flex gap-2 px-4 pb-4">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                priorityConfig.bg,
                priorityConfig.color,
              )}
            >
              <priorityConfig.icon className="size-3" />
              {client.priority}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium",
                statusConfig.bg,
                statusConfig.color,
              )}
            >
              {client.status}
            </span>
          </div>
        </div>

        <div className="p-4 space-y-6">
          {/* Location */}
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <MapPin className="size-3.5" />
              Location
            </h3>
            <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/40 px-4 py-3">
              <span className="text-sm">
                {client.countryFlag} {client.cityLocation}
              </span>
              {client.googleMapsUrl && (
                <a
                  href={client.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="size-3" />
                  Maps
                </a>
              )}
            </div>
          </div>

          {/* Contact Info */}
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              Contact Information
            </h3>
            <div className="space-y-2">
              {/* Phone */}
              {client.contactPhone && client.contactPhone !== "-" && (
                <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/40 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Phone className="size-4 text-muted-foreground" />
                    <span className="text-sm">{client.contactPhone}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => copyToClipboard(client.contactPhone!, "phone")}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                      title="Copy phone"
                    >
                      {copiedField === "phone" ? (
                        <Check className="size-3.5 text-badge-green" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                    <a
                      href={`tel:${client.contactPhone}`}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                      title="Call"
                    >
                      <Phone className="size-3.5" />
                    </a>
                  </div>
                </div>
              )}

              {/* Email */}
              {client.email && client.email !== "-" && (
                <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/40 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Mail className="size-4 text-muted-foreground" />
                    <span className="text-sm">{client.email}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => copyToClipboard(client.email!, "email")}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                      title="Copy email"
                    >
                      {copiedField === "email" ? (
                        <Check className="size-3.5 text-badge-green" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                    <a
                      href={`mailto:${client.email}`}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                      title="Send email"
                    >
                      <Mail className="size-3.5" />
                    </a>
                  </div>
                </div>
              )}

              {/* Website */}
              <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/40 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Globe className="size-4 text-muted-foreground" />
                  <span className="text-sm">
                    {client.websiteUrl && client.websiteUrl !== "-"
                      ? client.websiteUrl
                      : "No website"}
                  </span>
                </div>
                {client.websiteUrl && client.websiteUrl !== "-" && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => copyToClipboard(client.websiteUrl!, "website")}
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                      title="Copy URL"
                    >
                      {copiedField === "website" ? (
                        <Check className="size-3.5 text-badge-green" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                    <a
                      href={client.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                      title="Open website"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  </div>
                )}
              </div>

              {/* WhatsApp */}
              <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/40 px-4 py-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="size-4 text-muted-foreground" />
                  <span className="text-sm">WhatsApp: {client.whatsappStatus}</span>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    client.whatsappStatus === "Verified"
                      ? "bg-badge-green-bg text-badge-green"
                        : client.whatsappStatus === "Not Available"
                          ? "bg-badge-red-bg text-badge-red"
                          : "bg-badge-yellow-bg text-badge-yellow",
                  )}
                >
                  {client.whatsappStatus === "Verified" ? (
                    <Check className="inline size-3" />
                  ) : client.whatsappStatus === "Not Available" ? (
                    <AlertTriangle className="inline size-3" />
                  ) : null}{" "}
                  {client.whatsappStatus}
                </span>
              </div>
            </div>
          </div>

          {/* Website Status */}
          {client.websiteStatusType && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Globe className="size-3.5" />
                Website Analysis
              </h3>
              <div
                className={cn(
                  "rounded-xl border px-4 py-3",
                  client.websiteStatusType === "no_website"
                    ? "border-badge-orange/30 bg-badge-orange-bg"
                      : client.websiteStatusType === "needs_upgrade"
                        ? "border-badge-yellow/30 bg-badge-yellow-bg"
                        : "border-badge-green/30 bg-badge-green-bg",
                )}
              >
                <span
                  className={cn(
                    "text-sm font-medium",
                    client.websiteStatusType === "no_website"
                      ? "text-badge-orange"
                      : client.websiteStatusType === "needs_upgrade"
                        ? "text-badge-yellow"
                        : "text-badge-green",
                  )}
                >
                  {client.websiteStatusType === "no_website"
                    ? "No Website Found"
                    : client.websiteStatusType === "needs_upgrade"
                      ? "Needs Upgrade"
                      : "Good Website"}
                </span>
              </div>
            </div>
          )}

          {/* AI Offer Script */}
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Bot className="size-3.5" />
              AI-Generated Offer
            </h3>
            <div className="rounded-xl border border-border bg-surface-2/40 p-4">
              {aiOffer ? (
                <pre className="whitespace-pre-wrap text-sm text-muted-foreground">{aiOffer}</pre>
              ) : (
                <p className="text-xs text-muted-foreground/60">
                  AI offer will be generated by Liam based on website analysis
                </p>
              )}
            </div>
          </div>

          {/* Source */}
          {client.sourceQuery && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <FileText className="size-3.5" />
                Source Query
              </h3>
              <div className="rounded-xl border border-border bg-surface-2/40 px-4 py-3">
                <code className="text-xs text-muted-foreground">{client.sourceQuery}</code>
              </div>
            </div>
          )}

          {/* Timestamps */}
          <div className="text-xs text-muted-foreground/60 space-y-1">
            <p>Created: {new Date(client.createdAt).toLocaleString()}</p>
            <p>Updated: {new Date(client.updatedAt).toLocaleString()}</p>
          </div>
        </div>
      </div>
    </>
  );
}
