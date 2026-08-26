alter table public.ai_improvement_proposals
  add column if not exists review_note text,
  add column if not exists proposal_version integer not null default 1
    check (proposal_version > 0),
  add column if not exists supersedes_proposal_id uuid
    references public.ai_improvement_proposals(id) on delete set null;

create index if not exists ai_improvement_proposals_knowledge_id_idx
  on public.ai_improvement_proposals(knowledge_id)
  where knowledge_id is not null;
create index if not exists ai_improvement_proposals_supersedes_idx
  on public.ai_improvement_proposals(supersedes_proposal_id)
  where supersedes_proposal_id is not null;
create index if not exists ai_outcomes_interaction_id_idx
  on public.ai_outcomes(interaction_id)
  where interaction_id is not null;

create table public.ai_improvement_proposal_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id uuid not null references public.ai_improvement_proposals(id) on delete cascade,
  previous_status text,
  new_status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  reason text,
  proposal_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index ai_improvement_proposal_events_proposal_idx
  on public.ai_improvement_proposal_events(proposal_id, created_at desc);
create index ai_improvement_proposal_events_org_idx
  on public.ai_improvement_proposal_events(organization_id, created_at desc);
create index ai_improvement_proposal_events_actor_idx
  on public.ai_improvement_proposal_events(actor_id)
  where actor_id is not null;

alter table public.ai_improvement_proposal_events enable row level security;
create policy ai_improvement_proposal_events_member_select
  on public.ai_improvement_proposal_events for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));
revoke all on public.ai_improvement_proposal_events from anon, authenticated;
grant select on public.ai_improvement_proposal_events to authenticated;
grant all on public.ai_improvement_proposal_events to service_role;

create or replace function private.audit_improvement_proposal_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.ai_improvement_proposal_events(
      organization_id, proposal_id, previous_status, new_status, actor_id,
      reason, proposal_snapshot
    ) values (
      new.organization_id, new.id,
      case when tg_op = 'UPDATE' then old.status else null end,
      new.status, coalesce(new.reviewed_by, new.created_by), new.review_note,
      to_jsonb(new) - 'proposed_content' || jsonb_build_object(
        'proposed_content_digest', encode(extensions.digest(new.proposed_content::text, 'sha256'), 'hex')
      )
    );
  end if;
  return new;
end;
$$;
revoke all on function private.audit_improvement_proposal_status() from public, anon, authenticated;

drop trigger if exists audit_improvement_proposal_status on public.ai_improvement_proposals;
create trigger audit_improvement_proposal_status
after insert or update of status on public.ai_improvement_proposals
for each row execute function private.audit_improvement_proposal_status();

insert into public.ai_improvement_proposal_events(
  organization_id, proposal_id, previous_status, new_status, actor_id,
  reason, proposal_snapshot, created_at
)
select p.organization_id, p.id, null, p.status, coalesce(p.reviewed_by, p.created_by),
       'Backfilled audit event',
       to_jsonb(p) - 'proposed_content' || jsonb_build_object(
         'proposed_content_digest', encode(extensions.digest(p.proposed_content::text, 'sha256'), 'hex')
       ),
       p.created_at
from public.ai_improvement_proposals p
where not exists (
  select 1 from public.ai_improvement_proposal_events e where e.proposal_id = p.id
);

create or replace function public.review_improvement_proposal(
  p_proposal_id uuid,
  p_reviewer_id uuid,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.ai_improvement_proposals%rowtype;
  next_status text;
begin
  if p_decision not in ('approve', 'reject') then
    raise exception 'Unsupported review decision';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'Review reason is required';
  end if;

  select * into proposal
  from public.ai_improvement_proposals
  where id = p_proposal_id
  for update;
  if not found then raise exception 'Proposal not found'; end if;
  if proposal.status <> 'pending_review' then
    raise exception 'Proposal is not pending review';
  end if;
  if p_decision = 'approve' and proposal.target_type = 'knowledge' then
    raise exception 'Knowledge proposals must use versioned apply function';
  end if;

  next_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;
  update public.ai_improvement_proposals
     set status = next_status,
         reviewed_by = p_reviewer_id,
         reviewed_at = now(),
         review_note = trim(p_reason),
         updated_at = now()
   where id = proposal.id;

  return jsonb_build_object(
    'proposal_id', proposal.id,
    'status', next_status,
    'requires_manual_implementation', next_status = 'approved'
  );
end;
$$;
revoke all on function public.review_improvement_proposal(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.review_improvement_proposal(uuid, uuid, text, text)
  to service_role;
