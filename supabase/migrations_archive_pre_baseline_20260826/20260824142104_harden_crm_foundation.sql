-- Tighten ownership checks and add the covering indexes reported by Supabase advisors.

drop policy if exists lead_clients_member_insert on public.lead_clients;
create policy lead_clients_member_insert on public.lead_clients for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_organization_member(organization_id, (select auth.uid()))
);

drop policy if exists lead_clients_member_update on public.lead_clients;
create policy lead_clients_member_update on public.lead_clients for update to authenticated
using (private.is_organization_member(organization_id, (select auth.uid())))
with check (
  user_id = (select auth.uid())
  and private.is_organization_member(organization_id, (select auth.uid()))
);

drop policy if exists openclaw_tasks_member_insert on public.openclaw_tasks;
create policy openclaw_tasks_member_insert on public.openclaw_tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.is_organization_member(organization_id, (select auth.uid()))
);

drop policy if exists openclaw_goals_member_insert on public.openclaw_goals;
create policy openclaw_goals_member_insert on public.openclaw_goals for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.is_organization_member(organization_id, (select auth.uid()))
);

create index if not exists lead_clients_user_id_idx on public.lead_clients(user_id);
create index if not exists deals_client_fk_idx on public.deals(organization_id, client_id);
create index if not exists deals_project_fk_idx on public.deals(organization_id, project_id);
create index if not exists deals_owner_id_idx on public.deals(owner_id);
create index if not exists deals_created_by_idx on public.deals(created_by);
create index if not exists client_interactions_deal_id_idx on public.client_interactions(deal_id);
create index if not exists client_interactions_created_by_idx on public.client_interactions(created_by);
create index if not exists calendar_events_client_fk_idx on public.calendar_events(organization_id, client_id);
create index if not exists calendar_events_task_fk_idx on public.calendar_events(organization_id, task_id);
create index if not exists calendar_events_deal_id_idx on public.calendar_events(deal_id);
create index if not exists calendar_events_created_by_idx on public.calendar_events(created_by);
create index if not exists openclaw_tasks_created_by_idx on public.openclaw_tasks(created_by);
create index if not exists openclaw_goals_created_by_idx on public.openclaw_goals(created_by);
create index if not exists openclaw_improvements_approved_by_idx on public.openclaw_improvements(approved_by);
create index if not exists openclaw_analyses_goal_id_idx on public.openclaw_analyses(goal_id);
create index if not exists ai_action_audit_user_id_idx on public.ai_action_audit(user_id);
;
