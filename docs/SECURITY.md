# Orbit CRM security runbook

## Trust boundaries

- Browser: only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never place provider, service-role, internal, gateway or webhook secrets in a `VITE_` variable.
- Vercel: `INTERNAL_API_TOKEN`, Supabase publishable configuration and server-only integration secrets. The browser sends a Supabase JWT; the Vercel proxy validates or forwards it and adds the internal token.
- Render backend: the same `INTERNAL_API_TOKEN` as Vercel, `SUPABASE_SERVICE_ROLE_KEY`, provider keys and separate OpenClaw gateway/webhook tokens.
- OpenClaw service: `OPENCLAW_GATEWAY_TOKEN`, `OPENCLAW_WEBHOOK_TOKEN` and model-provider credentials required by the gateway. It does not receive the Supabase service-role key.

Do not reuse one value for `INTERNAL_API_TOKEN`, `OPENCLAW_GATEWAY_TOKEN` and
`OPENCLAW_WEBHOOK_TOKEN`.

## Secret rotation

Rotation is an external production change. Perform it during a maintenance window:

1. Generate three independent random values locally with `openssl rand -hex 32`.
2. Rotate `OPENCLAW_GATEWAY_TOKEN` in OpenClaw and Render backend, then verify gateway health.
3. Rotate `OPENCLAW_WEBHOOK_TOKEN` in OpenClaw and Render backend, then send one signed test callback.
4. Rotate `INTERNAL_API_TOKEN` in Render and Vercel together, redeploy both, then verify an authenticated API request.
5. Revoke old values only after the corresponding smoke test (быстрая проверка).
6. Never print values in logs, tickets, screenshots or deployment output.

## Authentication and authorization

- HTTP AI/OpenClaw/Learning endpoints require both the server-to-server token and a valid Supabase JWT.
- Every organization operation checks membership and RBAC (ролевые права) before using the service role.
- WebSocket authentication uses the `orbit-auth` subprotocol and a base64url-encoded session token in a second subprotocol. Tokens are never placed in the URL.
- Supabase public tables use RLS; the `task-files` bucket is private and its object path starts with the organization UUID.

## Audit and monitoring

- Every backend HTTP response includes `X-Correlation-ID`; logs contain method, path, status, duration and correlation ID, but not query strings, tokens or request bodies.
- OpenClaw actions are stored in `ai_action_audit`; approval state changes are stored in `ai_improvement_proposal_events`; communications use `communication_events`.
- Trace an AI action:

```sql
select * from public.ai_action_audit
where organization_id = '<organization_uuid>'
  and correlation_id = '<correlation_uuid>';
```

- Alert on repeated 401/403/429/5xx responses, failed OpenClaw actions, webhook signature failures and daily action-limit exhaustion.

## Supabase Auth action required

Enable **Leaked password protection** in Supabase Dashboard → Authentication →
Security. This cannot be enabled through a database migration. Re-run Security
Advisor afterward; the `auth_leaked_password_protection` warning must disappear.
