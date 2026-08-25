create index if not exists ai_user_memory_revisions_memory_id_idx
  on public.ai_user_memory_revisions(memory_id);

create index if not exists ai_user_memory_revisions_user_id_idx
  on public.ai_user_memory_revisions(user_id);
