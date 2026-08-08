import { FormEvent, useState } from "react";
import { LockKeyhole, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export function AuthScreen() {
  const { status, error, signInWithPassword, signUpWithPassword } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    setBusy(true);
    setNotice(null);
    const ok =
      mode === "signin"
        ? await signInWithPassword(email.trim(), password)
        : await signUpWithPassword(email.trim(), password, fullName.trim() || undefined);

    if (ok && mode === "signup") {
      setNotice("Аккаунт создан. Если в Supabase включено подтверждение email, проверьте почту.");
    }
    setBusy(false);
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background px-5 py-10">
      <div className="pointer-events-none fixed inset-0 opacity-70 [background:radial-gradient(60rem_40rem_at_15%_-10%,color-mix(in_oklab,var(--acc-1)_16%,transparent),transparent),radial-gradient(50rem_40rem_at_95%_10%,color-mix(in_oklab,var(--acc-2)_14%,transparent),transparent)]" />

      <section className="panel relative w-full max-w-md p-6 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </div>
          <div>
            <p className="font-display text-base font-semibold">Orbit CRM</p>
            <p className="text-xs text-muted-foreground">защищённый вход</p>
          </div>
        </div>

        {status === "unconfigured" ? (
          <div className="rounded-xl border border-destructive/35 bg-destructive/10 p-4 text-sm text-destructive">
            Supabase не настроен. Добавьте переменные окружения `VITE_SUPABASE_URL` и
            `VITE_SUPABASE_PUBLISHABLE_KEY`.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="flex gap-1 rounded-xl border border-border bg-surface-2/60 p-1">
              {(
                [
                  ["signin", "Вход"],
                  ["signup", "Регистрация"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setMode(key);
                    setNotice(null);
                  }}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-sm transition",
                    mode === key
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === "signup" && (
              <label className="block">
                <span className="mb-1 block text-xs text-muted-foreground">Имя</span>
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2.5 text-sm outline-none transition focus:border-primary/60"
                  autoComplete="name"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                required
                className="w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2.5 text-sm outline-none transition focus:border-primary/60"
                autoComplete="email"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">Пароль</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                required
                minLength={6}
                className="w-full rounded-xl border border-border bg-surface-2/60 px-3 py-2.5 text-sm outline-none transition focus:border-primary/60"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </label>

            {(error || notice) && (
              <div
                className={cn(
                  "rounded-xl border p-3 text-sm",
                  error
                    ? "border-destructive/35 bg-destructive/10 text-destructive"
                    : "border-primary/35 bg-primary/10 text-primary",
                )}
              >
                {error ?? notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-70"
            >
              <LockKeyhole className="size-4" />
              {busy ? "Проверяю…" : mode === "signin" ? "Войти" : "Создать аккаунт"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
