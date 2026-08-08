import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl = import.meta.env["VITE_SUPABASE_URL"]?.trim() ?? "";
const supabasePublishableKey = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"]?.trim() ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

export type AppSupabaseClient = SupabaseClient<Database>;

export const supabase: AppSupabaseClient | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function getSupabaseClient(): AppSupabaseClient {
  if (!supabase) {
    throw new Error(
      "Supabase не настроен. Укажите VITE_SUPABASE_URL и VITE_SUPABASE_PUBLISHABLE_KEY.",
    );
  }

  return supabase;
}
