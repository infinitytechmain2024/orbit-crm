import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Play,
  Clock,
  CheckCircle,
  XCircle,
  FileText,
  Download,
  RefreshCw,
  Zap,
  Building2,
  MapPin,
  Tag,
  Hash,
  ExternalLink,
  ArrowRight,
  Bot,
  Database,
  AlertCircle,
} from "lucide-react";
import { AppShell } from "@/components/crm/AppShell";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/lead-search")({
  head: () => ({
    meta: [
      { title: "Поиск лидов — Orbit CRM" },
      {
        name: "description",
        content: "AI-генерация потенциальных клиентов с помощью OpenManus + Llama 3.2",
      },
      { property: "og:title", content: "Поиск лидов — Orbit CRM" },
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

interface Report {
  filename: string;
  path: string;
  size_bytes: number;
  created_at: string;
}

interface SystemStatus {
  ollama: { available: boolean; url: string };
  notion: { configured: boolean; database_set: boolean };
}

function LeadSearchPage() {
  const [industry, setIndustry] = useState("wellness");
  const [location, setLocation] = useState("Russia");
  const [companySize, setCompanySize] = useState("any");
  const [keywords, setKeywords] = useState("");
  const [maxResults, setMaxResults] = useState(20);

  const [currentJob, setCurrentJob] = useState<SearchJob | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"search" | "reports">("search");

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

  // Fetch reports list
  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch(`${LEAD_GEN_API}/api/reports`);
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    checkStatus();
    fetchReports();
  }, [checkStatus, fetchReports]);

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
            fetchReports();
          }
        }
      } catch {
        // silently fail
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [currentJob, fetchReports]);

  const startSearch = async () => {
    setError(null);
    setIsSearching(true);

    try {
      const res = await fetch(`${LEAD_GEN_API}/api/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          criteria: {
            industry,
            location,
            company_size: companySize,
            keywords: keywords
              .split(",")
              .map((k) => k.trim())
              .filter(Boolean),
            max_results: maxResults,
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
    } catch (e: any) {
      setError(e.message);
      setIsSearching(false);
    }
  };

  const syncToNotion = async (reportPath: string) => {
    try {
      const res = await fetch(`${LEAD_GEN_API}/api/notion/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_path: reportPath, overwrite: false }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Sync failed");
      }

      const data = await res.json();
      alert(`Notion sync: ${data.synced} synced, ${data.skipped} skipped, ${data.errors} errors`);
    } catch (e: any) {
      alert(`Sync error: ${e.message}`);
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
    <AppShell title="AI Поиск лидов" subtitle="Автоматический поиск потенциальных клиентов">
      <div className="space-y-6">
        {/* System Status Bar */}
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-surface-2/40 p-4">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-primary" />
            <span className="text-xs font-medium">Система:</span>
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
            {systemStatus?.notion.configured ? (
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
            Новый поиск
          </button>
          <button
            onClick={() => setActiveTab("reports")}
            className={cn(
              "flex-1 rounded-lg px-4 py-2 text-sm font-medium transition",
              activeTab === "reports"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <FileText className="mr-2 inline size-4" />
            Отчёты ({reports.length})
          </button>
        </div>

        {/* Search Tab */}
        {activeTab === "search" && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Search Form */}
            <div className="lg:col-span-1">
              <div className="rounded-xl border border-border bg-surface-2/40 p-6">
                <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold">
                  <Zap className="size-4 text-primary" />
                  Параметры поиска
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Building2 className="size-3" /> Отрасль
                    </label>
                    <input
                      type="text"
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                      placeholder="wellness, fitness, beauty..."
                      className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <MapPin className="size-3" /> Локация
                    </label>
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Russia, Moscow..."
                      className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Tag className="size-3" /> Размер компании
                    </label>
                    <select
                      value={companySize}
                      onChange={(e) => setCompanySize(e.target.value)}
                      className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
                    >
                      <option value="any">Любой</option>
                      <option value="small">Малая (1-10)</option>
                      <option value="medium">Средняя (11-50)</option>
                      <option value="large">Крупная (50+)</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Tag className="size-3" /> Ключевые слова
                    </label>
                    <input
                      type="text"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder="CRM, автоматизация, запись..."
                      className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <Hash className="size-3" /> Макс. лидов
                    </label>
                    <input
                      type="number"
                      value={maxResults}
                      onChange={(e) => setMaxResults(Number(e.target.value))}
                      min={1}
                      max={100}
                      className="w-full rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-sm outline-none transition focus:border-primary/60"
                    />
                  </div>

                  <button
                    onClick={startSearch}
                    disabled={isSearching}
                    className={cn(
                      "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-medium transition",
                      isSearching
                        ? "bg-primary/50 text-primary-foreground cursor-not-allowed"
                        : "bg-primary text-primary-foreground hover:bg-primary/90",
                    )}
                  >
                    {isSearching ? (
                      <>
                        <Clock className="size-4 animate-spin" />
                        Поиск...
                      </>
                    ) : (
                      <>
                        <Play className="size-4" />
                        Начать поиск
                      </>
                    )}
                  </button>
                </div>

                {error && (
                  <div className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-xs text-red-400">
                    {error}
                  </div>
                )}
              </div>
            </div>

            {/* Job Status / Results */}
            <div className="lg:col-span-2">
              {currentJob ? (
                <div className="rounded-xl border border-border bg-surface-2/40 p-6">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      {statusIcon(currentJob.status)}
                      Задача #{currentJob.job_id}
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
                        ? "Выполняется"
                        : currentJob.status === "completed"
                          ? "Завершено"
                          : "Ошибка"}
                    </span>
                  </div>

                  {currentJob.status === "running" && (
                    <div className="space-y-3">
                      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                        <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        AI-агент анализирует источники и ищет потенциальных клиентов...
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
                          <p className="text-xs text-muted-foreground">Найдено лидов</p>
                        </div>
                        <div className="rounded-lg border border-border bg-surface-2/60 p-3 text-center">
                          <p className="text-2xl font-bold text-green-400">
                            {currentJob.report_path ? "✓" : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">Отчёт</p>
                        </div>
                        <div className="rounded-lg border border-border bg-surface-2/60 p-3 text-center">
                          <p className="text-2xl font-bold text-purple-400">
                            {currentJob.created_at
                              ? new Date(currentJob.created_at).toLocaleTimeString("ru-RU", {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">Время запуска</p>
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
                            Открыть отчёт
                            <ExternalLink className="size-3" />
                          </a>
                          <button
                            onClick={() => syncToNotion(currentJob.report_path!)}
                            className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-xs font-medium transition hover:border-purple-400/50 hover:bg-surface-2"
                          >
                            <Download className="size-3.5" />
                            Экспорт в Notion
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {currentJob.status === "failed" && (
                    <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-400">
                      {currentJob.error || "Произошла ошибка при поиске"}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-2/20 p-12 text-center">
                  <Bot className="mb-4 size-12 text-muted-foreground/40" />
                  <h3 className="text-sm font-medium text-muted-foreground">
                    Настройте параметры и нажмите «Начать поиск»
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground/60">
                    AI-агент найдёт потенциальных клиентов и создаст详细的分析
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Reports Tab */}
        {activeTab === "reports" && (
          <div className="space-y-4">
            {reports.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-2/20 p-12 text-center">
                <FileText className="mb-4 size-12 text-muted-foreground/40" />
                <h3 className="text-sm font-medium text-muted-foreground">
                  Отчёты пока не созданы
                </h3>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Запустите поиск, чтобы сгенерировать первый отчёт
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {reports.map((report) => (
                  <div
                    key={report.filename}
                    className="group rounded-xl border border-border bg-surface-2/40 p-4 transition hover:border-primary/30"
                  >
                    <div className="mb-3 flex items-start justify-between">
                      <FileText className="size-5 text-primary/60" />
                      <span className="text-[10px] text-muted-foreground">
                        {(report.size_bytes / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <h4 className="mb-1 text-sm font-medium truncate">{report.filename}</h4>
                    <p className="text-xs text-muted-foreground">
                      {new Date(report.created_at).toLocaleDateString("ru-RU", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <a
                        href={`${LEAD_GEN_API}/api/reports/${report.filename}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium transition hover:border-primary/50"
                      >
                        <ExternalLink className="size-3" />
                        Просмотр
                      </a>
                      <button
                        onClick={() => syncToNotion(report.path)}
                        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-medium transition hover:border-purple-400/50"
                      >
                        <ArrowRight className="size-3" />
                        Notion
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
