create or replace function private.sync_crm_memory_graph()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  event_node_id uuid; linked_node_id uuid; actor_id uuid;
  row_data jsonb; org_id uuid; row_id uuid; client_id uuid; task_id uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes where organization_id=old.organization_id
      and entity_type=tg_argv[0] and entity_id=old.id and is_automatic;
    return old;
  end if;
  row_data := to_jsonb(new);
  org_id := (row_data->>'organization_id')::uuid;
  row_id := (row_data->>'id')::uuid;
  actor_id := coalesce((row_data->>'user_id')::uuid,(row_data->>'created_by')::uuid);
  client_id := (row_data->>'client_id')::uuid;
  task_id := (row_data->>'task_id')::uuid;
  insert into public.graph_nodes(organization_id,entity_type,entity_id,title,status,metadata,is_automatic,created_by)
  values(org_id,tg_argv[0],row_id,coalesce(row_data->>'business_name',row_data->>'title'),row_data->>'status',
    case when tg_argv[0]='client' then jsonb_build_object('category',row_data->>'category','city',row_data->>'city_location')
    else jsonb_build_object('starts_at',row_data->>'starts_at','ends_at',row_data->>'ends_at') end,true,actor_id)
  on conflict(organization_id,entity_type,entity_id) do update set title=excluded.title,status=excluded.status,
    metadata=public.graph_nodes.metadata||excluded.metadata,updated_at=now() returning id into event_node_id;
  if tg_argv[0]='calendar_event' then
    delete from public.graph_relations where organization_id=org_id and source_node_id=event_node_id
      and relation_type in ('for_client','for_task') and is_automatic;
    if client_id is not null then
      select id into linked_node_id from public.graph_nodes where organization_id=org_id and entity_type='client' and entity_id=client_id;
      if linked_node_id is not null then
        insert into public.graph_relations(organization_id,source_type,source_id,target_type,target_id,relation_type,source_node_id,target_node_id,direction,is_automatic,created_by)
        values(org_id,'calendar_event',row_id,'client',client_id,'for_client',event_node_id,linked_node_id,'one_way',true,actor_id)
        on conflict(organization_id,source_node_id,target_node_id,relation_type,direction) do nothing;
      end if;
    end if;
    if task_id is not null then
      select id into linked_node_id from public.graph_nodes where organization_id=org_id and entity_type='task' and entity_id=task_id;
      if linked_node_id is not null then
        insert into public.graph_relations(organization_id,source_type,source_id,target_type,target_id,relation_type,source_node_id,target_node_id,direction,is_automatic,created_by)
        values(org_id,'calendar_event',row_id,'task',task_id,'for_task',event_node_id,linked_node_id,'one_way',true,actor_id)
        on conflict(organization_id,source_node_id,target_node_id,relation_type,direction) do nothing;
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_crm_memory_graph() from public,anon,authenticated;
