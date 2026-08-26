create policy openclaw_webhook_events_service_all
on private.openclaw_webhook_events
for all
to service_role
using (true)
with check (true);;
