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
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadClient } from "@/types/lead";
import type { AiOfferScript } from "@/types/lead";
import { generateAiOffer } from "@/agents/liam";

interface LeadDetailDrawerProps {
  client: LeadClient | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: (id: string, patch: Partial<LeadClient>) => void;
}

const PRIORITY_CONFIG = {
  High: { color: "text-red-400", bg: "bg-red-400/12", icon: Star },
  Middle: { color: "text-yellow-400", bg: "bg-yellow-400/12", icon: Star },
  Low: { color: "text-green-400", bg: "bg-green-400/12", icon: Star },
};

const STATUS_CONFIG = {
  Lead: { color: "text-blue-400", bg: "bg-blue-400/12" },
  New: { color: "text-purple-400", bg: "bg-purple-400/12" },
  "In Progress": { color: "text-yellow-400", bg: "bg-yellow-400/12" },
  Rejected: { color: "text-red-400", bg: "bg-red-400/12" },
  Archived: { color: "text-gray-400", bg: "bg-gray-400/12" },
};

export function LeadDetailDrawer({ client, isOpen, onClose, onUpdate }: LeadDetailDrawerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [generatingOffer, setGeneratingOffer] = useState(false);
  const [aiOfferData, setAiOfferData] = useState<AiOfferScript | null>(
    client?.aiOfferScript && typeof client.aiOfferScript === "object"
      ? (client.aiOfferScript as unknown as AiOfferScript)
      : null
  );

  if (!isOpen || !client) return null;

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
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

  const handleGenerateOffer = async () => {
    setGeneratingOffer(true);
    try {
      const offer = await generateAiOffer(
        client.businessName,
        client.category,
        client.websiteUrl === "-" ? null : client.websiteUrl,
        client.cityLocation
      );
      setAiOfferData(offer);
      onUpdate?.(client.id, { aiOfferScript: offer as unknown as import("@/lib/supabase/database.types").Json });
    } catch (error) {
      console.error("Failed to generate AI offer:", error);
    } finally {
      setGeneratingOffer(false);
    }
  };

  const priorityConfig = PRIORITY_CONFIG[client.priority];
  const statusConfig = STATUS_CONFIG[client.status];

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 transition-opacity" onClick={onClose} />

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
                        <Check className="size-3.5 text-green-400" />
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
                        <Check className="size-3.5 text-green-400" />
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
                        <Check className="size-3.5 text-green-400" />
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

              <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2/40 px-4 py-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="size-4 text-muted-foreground" />
                  <span className="text-sm">WhatsApp: {client.whatsappStatus}</span>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-medium",
                    client.whatsappStatus === "Verified"
                      ? "bg-green-400/12 text-green-400"
                      : client.whatsappStatus === "Not Available"
                        ? "bg-red-400/12 text-red-400"
                        : "bg-yellow-400/12 text-yellow-400",
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
                    ? "border-orange-500/30 bg-orange-500/10"
                    : client.websiteStatusType === "needs_upgrade"
                      ? "border-yellow-500/30 bg-yellow-500/10"
                      : "border-green-500/30 bg-green-500/10",
                )}
              >
                <span
                  className={cn(
                    "text-sm font-medium",
                    client.websiteStatusType === "no_website"
                      ? "text-orange-400"
                      : client.websiteStatusType === "needs_upgrade"
                        ? "text-yellow-400"
                        : "text-green-400",
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

          {/* AI Offer */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Bot className="size-3.5" />
                AI-Generated Offer (Liam)
              </h3>
              <button
                onClick={handleGenerateOffer}
                disabled={generatingOffer}
                className="rounded-lg px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition disabled:opacity-50"
              >
                {generatingOffer ? (
                  <Loader2 className="inline size-3 animate-spin" />
                ) : (
                  "Generate"
                )}
              </button>
            </div>
            <div className="rounded-xl border border-border bg-surface-2/40 p-4 space-y-4">
              {aiOfferData ? (
                <>
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-1">Audit</h4>
                    <p className="text-sm text-muted-foreground">{aiOfferData.audit}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-1">Proposal</h4>
                    <p className="text-sm text-muted-foreground">{aiOfferData.proposal}</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground mb-1">Call Script</h4>
                    <p className="text-sm text-muted-foreground">{aiOfferData.callScript}</p>
                  </div>
                  {aiOfferData.weakPoints.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-muted-foreground mb-1">Weak Points</h4>
                      <ul className="list-disc list-inside text-sm text-muted-foreground">
                        {aiOfferData.weakPoints.map((wp, i) => (
                          <li key={i}>{wp}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground/60">
                  Click "Generate" to create an AI-powered sales pitch from Liam
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
