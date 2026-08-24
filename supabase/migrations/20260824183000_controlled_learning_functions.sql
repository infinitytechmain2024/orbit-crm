create or replace function private.apply_knowledge_proposal(p_proposal_id uuid, p_reviewer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.ai_improvement_proposals%rowtype;
  knowledge public.company_knowledge%rowtype;
  next_version integer;
begin
  select * into proposal from public.ai_improvement_proposals
  where id = p_proposal_id for update;
  if not found then raise exception 'Proposal not found'; end if;
  if proposal.status <> 'pending_review' then raise exception 'Proposal is not pending review'; end if;
  if proposal.target_type <> 'knowledge' or proposal.knowledge_id is null then
    raise exception 'Only knowledge proposals can be applied automatically';
  end if;

  select * into knowledge from public.company_knowledge
  where id = proposal.knowledge_id and organization_id = proposal.organization_id for update;
  if not found then raise exception 'Knowledge entry not found'; end if;
  next_version := knowledge.current_version + 1;

  insert into public.company_knowledge_versions(
    organization_id, knowledge_id, version, content, change_summary, source, created_by
  ) values (
    proposal.organization_id, knowledge.id, next_version, proposal.proposed_content,
    proposal.title, 'approved_ai_proposal', p_reviewer_id
  );
  update public.company_knowledge set current_version = next_version, updated_at = now()
  where id = knowledge.id;
  update public.ai_improvement_proposals set
    status = 'applied', reviewed_by = p_reviewer_id, reviewed_at = now(),
    applied_version = next_version, rollback_version = knowledge.current_version, updated_at = now()
  where id = proposal.id;

  return jsonb_build_object('proposal_id', proposal.id, 'knowledge_id', knowledge.id, 'version', next_version);
end;
$$;

create or replace function private.rollback_knowledge_proposal(p_proposal_id uuid, p_reviewer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.ai_improvement_proposals%rowtype;
  knowledge public.company_knowledge%rowtype;
  prior_content jsonb;
  next_version integer;
begin
  select * into proposal from public.ai_improvement_proposals
  where id = p_proposal_id for update;
  if not found then raise exception 'Proposal not found'; end if;
  if proposal.status <> 'applied' or proposal.rollback_version is null then
    raise exception 'Proposal cannot be rolled back';
  end if;
  select * into knowledge from public.company_knowledge
  where id = proposal.knowledge_id and organization_id = proposal.organization_id for update;
  select content into prior_content from public.company_knowledge_versions
  where knowledge_id = knowledge.id and version = proposal.rollback_version;
  if prior_content is null then raise exception 'Rollback version not found'; end if;
  next_version := knowledge.current_version + 1;

  insert into public.company_knowledge_versions(
    organization_id, knowledge_id, version, content, change_summary, source, created_by
  ) values (
    proposal.organization_id, knowledge.id, next_version, prior_content,
    'Rollback: ' || proposal.title, 'rollback', p_reviewer_id
  );
  update public.company_knowledge set current_version = next_version, updated_at = now()
  where id = knowledge.id;
  update public.ai_improvement_proposals set status = 'rolled_back', reviewed_by = p_reviewer_id,
    reviewed_at = now(), updated_at = now() where id = proposal.id;
  return jsonb_build_object('proposal_id', proposal.id, 'knowledge_id', knowledge.id, 'version', next_version);
end;
$$;

revoke all on function private.apply_knowledge_proposal(uuid, uuid) from public, anon, authenticated;
revoke all on function private.rollback_knowledge_proposal(uuid, uuid) from public, anon, authenticated;
grant execute on function private.apply_knowledge_proposal(uuid, uuid) to service_role;
grant execute on function private.rollback_knowledge_proposal(uuid, uuid) to service_role;
