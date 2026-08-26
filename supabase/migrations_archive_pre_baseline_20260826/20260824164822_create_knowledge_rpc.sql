create or replace function public.create_knowledge_entry(
  p_organization_id uuid,
  p_slug text,
  p_title text,
  p_category text,
  p_content jsonb,
  p_created_by uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare entry public.company_knowledge%rowtype;
begin
  insert into public.company_knowledge(organization_id, slug, title, category, created_by, current_version)
  values(p_organization_id, p_slug, p_title, coalesce(nullif(p_category, ''), 'general'), p_created_by, 1)
  returning * into entry;
  insert into public.company_knowledge_versions(
    organization_id, knowledge_id, version, content, change_summary, source, created_by
  ) values(p_organization_id, entry.id, 1, p_content, 'Initial version', 'human', p_created_by);
  return jsonb_build_object('id', entry.id, 'version', 1);
end;
$$;
revoke all on function public.create_knowledge_entry(uuid,text,text,text,jsonb,uuid)
  from public, anon, authenticated;
grant execute on function public.create_knowledge_entry(uuid,text,text,text,jsonb,uuid) to service_role;
;
