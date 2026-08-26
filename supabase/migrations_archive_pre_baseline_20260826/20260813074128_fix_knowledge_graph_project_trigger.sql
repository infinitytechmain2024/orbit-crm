create or replace function private.sync_graph_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes
    where organization_id = old.organization_id and entity_type = 'project' and entity_id = old.id;
    return old;
  end if;

  perform private.upsert_graph_node(
    new.organization_id, 'project', new.id, new.name, new.id, new.status::text,
    jsonb_build_object(
      'description', new.description,
      'priority', new.priority,
      'due_date', new.due_date,
      'project_color', private.graph_project_color(new.name, new.id)
    ),
    true, new.created_by, new.created_at
  );
  return new;
end;
$$;

create index if not exists graph_nodes_created_by_idx
  on public.graph_nodes (created_by) where created_by is not null;
create index if not exists graph_relations_created_by_v2_idx
  on public.graph_relations (created_by) where created_by is not null;
;
