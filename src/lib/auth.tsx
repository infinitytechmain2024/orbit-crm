import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/client";

type AuthStatus = "loading" | "authenticated" | "anonymous" | "unconfigured";

type AuthContextValue = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  error: string | null;
  signInWithPassword: (email: string, password: string) => Promise<boolean>;
  signUpWithPassword: (email: string, password: string, fullName?: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearAuthError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function authErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Не удалось выполнить действие авторизации.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(
    isSupabaseConfigured ? "loading" : "unconfigured",
  );
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    let alive = true;

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!alive) return;
        if (sessionError) {
          setError(sessionError.message);
          setSession(null);
          setStatus("anonymous");
          return;
        }

        setSession(data.session);
        setStatus(data.session ? "authenticated" : "anonymous");
      })
      .catch((unknownError: unknown) => {
        if (!alive) return;
        setError(authErrorMessage(unknownError));
        setSession(null);
        setStatus("anonymous");
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setStatus(nextSession ? "authenticated" : "anonymous");
      setError(null);
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      error,
      signInWithPassword: async (email, password) => {
        if (!supabase) {
          setError("Supabase не настроен.");
          return false;
        }

        setError(null);
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          setError(signInError.message);
          return false;
        }

        return true;
      },
      signUpWithPassword: async (email, password, fullName) => {
        if (!supabase) {
          setError("Supabase не настроен.");
          return false;
        }

        setError(null);
        const signUpPayload = fullName
          ? {
              email,
              password,
              options: { data: { full_name: fullName } },
            }
          : { email, password };

        const { error: signUpError } = await supabase.auth.signUp(signUpPayload);

        if (signUpError) {
          setError(signUpError.message);
          return false;
        }

        return true;
      },
      signOut: async () => {
        if (!supabase) return;
        setError(null);
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) setError(signOutError.message);
      },
      clearAuthError: () => setError(null),
    }),
    [error, session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
