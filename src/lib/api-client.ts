import { getSupabaseClient } from "@/lib/supabase/client";

export async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const {
    data: { session },
  } = await getSupabaseClient().auth.getSession();
  if (!session?.access_token) throw new Error("Authentication is required");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.access_token}`);
  return fetch(input, { ...init, headers });
}
