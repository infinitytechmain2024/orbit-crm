export async function verifyProxyUser(request: Request): Promise<Response | null> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return Response.json({ error: "Authentication is required" }, { status: 401 });
  }
  const supabaseUrl = process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "";
  const publishableKey =
    process.env["SUPABASE_PUBLISHABLE_KEY"] ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "";
  if (!supabaseUrl || !publishableKey) {
    return Response.json({ error: "Server authentication is not configured" }, { status: 503 });
  }
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/user`, {
      headers: { apikey: publishableKey, authorization },
      cache: "no-store",
    });
    if (!response.ok) {
      return Response.json({ error: "Invalid authenticated session" }, { status: 401 });
    }
    return null;
  } catch {
    return Response.json({ error: "Authentication service is unavailable" }, { status: 502 });
  }
}
