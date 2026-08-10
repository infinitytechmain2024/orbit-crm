import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ListChecks,
  Mail,
  Wallet,
  Moon,
  Sun,
  Command,
  Bell,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Calendar,
  Users,
  ClipboardList,
  FolderKanban,
  Bot,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useCrm } from "@/lib/crm-store";
import { useAuth } from "@/lib/auth";
import { AiAssistant } from "./AiAssistant";
import { OrbitLogoFull, OrbitLogoIcon } from "./OrbitLogo";
import { cn } from "@/lib/utils";

const nav: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Дашборд", icon: LayoutDashboard },
  { to: "/tasks", label: "Задачи и проекты", icon: ListChecks },
  { to: "/projects", label: "Проекты", icon: FolderKanban },
  { to: "/calendar", label: "Календарь", icon: Calendar },
  { to: "/clients", label: "Клиенты", icon: Users },
  { to: "/requests", label: "Заявки и записи", icon: ClipboardList },
  { to: "/lead-search", label: "AI Поиск лидов", icon: Bot },
  { to: "/mail", label: "Почта", icon: Mail },
  { to: "/finance", label: "Финансы", icon: Wallet },
];

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const { theme, toggleTheme, emails, error, flash, clearError, clearFlash } = useCrm();
  const { user, signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const unread = emails.filter((e) => e.unread).length;
  const [collapsed, setCollapsed] = useState(false);
  const userInitial = user?.email?.charAt(0).toUpperCase() ?? "A";

  return (
    <div className="min-h-screen bg-background">
      <div className="pointer-events-none fixed inset-0 opacity-70 [background:radial-gradient(60rem_40rem_at_15%_-10%,color-mix(in_oklab,var(--acc-1)_16%,transparent),transparent),radial-gradient(50rem_40rem_at_95%_10%,color-mix(in_oklab,var(--acc-2)_14%,transparent),transparent)]" />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-sidebar/80 backdrop-blur-xl transition-all duration-200 lg:flex",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-3 border-b border-border py-5",
            collapsed ? "justify-center px-2" : "px-6",
          )}
        >
          <div className="text-primary">
            {collapsed ? <OrbitLogoIcon className="size-8" /> : <OrbitLogoFull className="h-8" />}
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-2 py-3">
          {nav.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                  collapsed && "justify-center px-2",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_var(--sidebar-border)]"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon
                  className={cn("size-4 shrink-0 transition-colors", active && "text-primary")}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1">{item.label}</span>
                    {item.to === "/mail" && unread > 0 && (
                      <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {unread}
                      </span>
                    )}
                  </>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-2">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2 text-muted-foreground transition hover:bg-sidebar-accent/60 hover:text-foreground"
            title={collapsed ? "Развернуть панель" : "Свернуть панель"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <>
                <PanelLeftClose className="size-4" />
                <span className="text-xs">Свернуть</span>
              </>
            )}
          </button>
        </div>
      </aside>

      <div
        className={cn("relative transition-all duration-200", collapsed ? "lg:pl-16" : "lg:pl-64")}
      >
        <header className="sticky top-0 z-20 glass">
          <div className="flex flex-wrap items-center gap-4 px-5 py-4 sm:px-8">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold sm:text-xl">{title}</h1>
              {subtitle && (
                <p className="truncate text-xs text-muted-foreground sm:text-sm">{subtitle}</p>
              )}
            </div>
            <div className="hidden items-center gap-2 rounded-xl border border-border bg-surface-2/70 px-3 py-2 text-xs text-muted-foreground md:flex">
              <Command className="size-3.5" />
              Быстрый поиск
              <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px]">⌘K</kbd>
            </div>
            <button
              className="grid size-9 place-items-center rounded-xl border border-border bg-surface-2/70 text-muted-foreground transition hover:text-foreground"
              aria-label="Уведомления"
            >
              <Bell className="size-4" />
            </button>
            <button
              onClick={toggleTheme}
              aria-label="Переключить тему"
              className="grid size-9 place-items-center rounded-xl border border-border bg-surface-2/70 transition hover:border-primary/50 hover:text-primary"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <button
              onClick={() => void signOut()}
              aria-label="Выйти"
              title={user?.email ? `Выйти из ${user.email}` : "Выйти"}
              className="grid size-9 place-items-center rounded-xl border border-border bg-surface-2/70 text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
            >
              <LogOut className="size-4" />
            </button>
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-acc-2 to-acc-1 text-sm font-semibold text-primary-foreground">
              {userInitial}
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:hidden">
            {nav.slice(0, 5).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs text-muted-foreground"
                activeProps={{ className: "bg-sidebar-accent text-foreground" }}
                activeOptions={{ exact: item.to === "/" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="px-5 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>

      <AiAssistant />

      {error && (
        <div className="fixed bottom-24 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-xl border border-destructive/35 bg-surface px-4 py-2 text-sm text-destructive shadow-xl animate-in slide-in-from-bottom-2">
          <span>{error}</span>
          <button
            onClick={clearError}
            className="text-xs text-muted-foreground transition hover:text-foreground"
          >
            Закрыть
          </button>
        </div>
      )}

      {flash && (
        <button
          onClick={clearFlash}
          className="fixed bottom-24 left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-primary/35 bg-surface px-4 py-2 text-sm text-primary shadow-xl animate-in slide-in-from-bottom-2"
        >
          {flash}
        </button>
      )}
    </div>
  );
}
