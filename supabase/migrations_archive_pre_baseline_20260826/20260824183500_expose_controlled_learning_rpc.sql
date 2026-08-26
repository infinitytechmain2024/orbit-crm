alter function private.apply_knowledge_proposal(uuid, uuid) set schema public;
alter function private.rollback_knowledge_proposal(uuid, uuid) set schema public;
revoke all on function public.apply_knowledge_proposal(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rollback_knowledge_proposal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apply_knowledge_proposal(uuid, uuid) to service_role;
grant execute on function public.rollback_knowledge_proposal(uuid, uuid) to service_role;
