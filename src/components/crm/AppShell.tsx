import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ListChecks,
  Mail,
  Wallet,
  Sparkles,
  Moon,
  Sun,
  Command,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode } from "react";
import { useCrm } from "@/lib/crm-store";
import { AiAssistant } from "./AiAssistant";
import { cn } from "@/lib/utils";

const nav: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/", label: "Дашборд", icon: LayoutDashboard },
  { to: "/tasks", label: "Задачи и проекты", icon: ListChecks },
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
  const { theme, toggleTheme, emails } = useCrm();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const unread = emails.filter((e) => e.unread).length;

  return (
    <div className="min-h-screen bg-background">
      <div className="pointer-events-none fixed inset-0 opacity-70 [background:radial-gradient(60rem_40rem_at_15%_-10%,color-mix(in_oklab,var(--acc-1)_16%,transparent),transparent),radial-gradient(50rem_40rem_at_95%_10%,color-mix(in_oklab,var(--acc-2)_14%,transparent),transparent)]" />

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-sidebar/80 backdrop-blur-xl lg:flex">
        <div className="flex items-center gap-3 px-6 py-6">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="font-display text-sm font-semibold">Orbit CRM</p>
            <p className="text-xs text-muted-foreground">персональная система</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 px-3">
          {nav.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_var(--sidebar-border)]"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                )}
              >
                <item.icon
                  className={cn("size-4 transition-colors", active && "text-primary")}
                />
                <span className="flex-1">{item.label}</span>
                {item.to === "/mail" && unread > 0 && (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {unread}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="m-3 rounded-xl border border-border bg-surface-2/60 p-4">
          <p className="text-xs text-muted-foreground">Единая память ИИ</p>
          <p className="mt-1 text-sm font-medium">Проиндексировано 128 объектов</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-acc-1 to-acc-2" />
          </div>
        </div>
      </aside>

      <div className="relative lg:pl-64">
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
            <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-acc-2 to-acc-1 text-sm font-semibold text-primary-foreground">
              A
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:hidden">
            {nav.map((item) => (
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
    </div>
  );
}
