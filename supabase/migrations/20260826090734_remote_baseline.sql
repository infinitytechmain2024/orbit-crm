


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."finance_transaction_type" AS ENUM (
    'income',
    'expense'
);


ALTER TYPE "public"."finance_transaction_type" OWNER TO "postgres";


CREATE TYPE "public"."lead_client_priority" AS ENUM (
    'High',
    'Middle',
    'Low'
);


ALTER TYPE "public"."lead_client_priority" OWNER TO "postgres";


CREATE TYPE "public"."lead_client_status" AS ENUM (
    'Lead',
    'New',
    'In Progress',
    'Rejected',
    'Archived'
);


ALTER TYPE "public"."lead_client_status" OWNER TO "postgres";


CREATE TYPE "public"."lead_website_status" AS ENUM (
    'no_website',
    'needs_upgrade',
    'good'
);


ALTER TYPE "public"."lead_website_status" OWNER TO "postgres";


CREATE TYPE "public"."organization_role" AS ENUM (
    'owner',
    'admin',
    'manager',
    'member',
    'accountant'
);


ALTER TYPE "public"."organization_role" OWNER TO "postgres";


CREATE TYPE "public"."project_priority" AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


ALTER TYPE "public"."project_priority" OWNER TO "postgres";


CREATE TYPE "public"."project_status" AS ENUM (
    'planned',
    'active',
    'paused',
    'completed',
    'archived'
);


ALTER TYPE "public"."project_status" OWNER TO "postgres";


CREATE TYPE "public"."task_priority" AS ENUM (
    'low',
    'med',
    'high'
);


ALTER TYPE "public"."task_priority" OWNER TO "postgres";


CREATE TYPE "public"."task_status" AS ENUM (
    'backlog',
    'planned',
    'in_progress',
    'review',
    'blocked',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."task_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."archive_ai_user_memory_revision"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.memory_value is distinct from old.memory_value
     or new.confidence is distinct from old.confidence
     or new.source is distinct from old.source then
    insert into public.ai_user_memory_revisions(
      memory_id, organization_id, user_id, memory_value, confidence, source,
      correction_note, changed_by
    ) values (
      old.id, old.organization_id, old.user_id, old.memory_value, old.confidence,
      old.source, new.correction_note, new.corrected_by
    );
  end if;
  new.last_verified_at := coalesce(new.last_verified_at, now());
  return new;
end;
$$;


ALTER FUNCTION "private"."archive_ai_user_memory_revision"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."audit_improvement_proposal_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."audit_improvement_proposal_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."backfill_graph_relations"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  row record;
  node_type text;
begin
  for row in select * from public.tasks loop
    if row.project_id is not null then
      perform private.upsert_graph_relation(
        row.organization_id, 'project', row.project_id, 'task', row.id,
        'contains', 'one_way', 1, row.author_id,
        jsonb_build_object('source_table', 'tasks', 'source_row', row.id)
      );
    end if;
    if row.parent_task_id is not null then
      perform private.upsert_graph_relation(
        row.organization_id, 'task', row.id, 'task', row.parent_task_id,
        'depends_on', 'one_way', 1, row.author_id,
        jsonb_build_object('source_table', 'tasks', 'source_row', row.id)
      );
    end if;
    if row.assignee_id is not null then
      perform private.upsert_graph_relation(
        row.organization_id, 'task', row.id, 'person', row.assignee_id,
        'assigned_to', 'one_way', 1, row.author_id,
        jsonb_build_object('source_table', 'tasks', 'source_row', row.id)
      );
    end if;
    perform private.upsert_graph_relation(
      row.organization_id, 'task', row.id, 'person', row.author_id,
      'created_by', 'one_way', 0.7, row.author_id,
      jsonb_build_object('source_table', 'tasks', 'source_row', row.id)
    );
  end loop;

  for row in select * from public.project_members loop
    perform private.upsert_graph_relation(
      row.organization_id, 'project', row.project_id, 'person', row.user_id,
      'assigned_to', 'two_way', 1, row.created_by,
      jsonb_build_object(
        'source_table', 'project_members',
        'source_row', row.project_id::text || ':' || row.user_id::text
      )
    );
  end loop;

  for row in select * from public.task_assignees loop
    perform private.upsert_graph_relation(
      row.organization_id, 'task', row.task_id, 'person', row.user_id,
      'assigned_to', 'one_way', 1, row.created_by,
      jsonb_build_object(
        'source_table', 'task_assignees',
        'source_row', row.task_id::text || ':' || row.user_id::text
      )
    );
  end loop;

  for row in select * from public.project_links loop
    perform private.upsert_graph_relation(
      row.organization_id, 'project', row.source_project_id, 'project', row.target_project_id,
      'related_to', 'two_way', 0.85, row.created_by,
      jsonb_build_object(
        'source_table', 'project_links',
        'source_row', row.source_project_id::text || ':' || row.target_project_id::text
      )
    );
  end loop;

  for row in select file.*, task.project_id from public.files file
    join public.tasks task on task.organization_id = file.organization_id and task.id = file.task_id
  loop
    node_type := private.graph_file_type(row.file_name, row.mime_type);
    perform private.upsert_graph_relation(
      row.organization_id, 'task', row.task_id, node_type, row.id,
      'created_from', 'one_way', 1, row.uploaded_by,
      jsonb_build_object('source_table', 'files', 'source_row', row.id)
    );
    if row.project_id is not null then
      perform private.upsert_graph_relation(
        row.organization_id, node_type, row.id, 'project', row.project_id,
        'belongs_to', 'one_way', 1, row.uploaded_by,
        jsonb_build_object('source_table', 'files', 'source_row', row.id)
      );
    end if;
  end loop;

  for row in select * from public.task_comments loop
    perform private.upsert_graph_relation(
      row.organization_id, 'task', row.task_id, 'message', row.id,
      'contains', 'one_way', 0.7, row.created_by,
      jsonb_build_object('source_table', 'task_comments', 'source_row', row.id)
    );
  end loop;

  for row in select * from public.task_checklist_items loop
    perform private.upsert_graph_relation(
      row.organization_id, 'task', row.task_id, 'checklist_item', row.id,
      'contains', 'one_way', 0.7, row.created_by,
      jsonb_build_object('source_table', 'task_checklist_items', 'source_row', row.id)
    );
  end loop;

  for row in select * from public.finance_transactions where task_id is not null loop
    perform private.upsert_graph_relation(
      row.organization_id, 'task', row.task_id, 'finance', row.id,
      'contains', 'one_way', 0.8, row.created_by,
      jsonb_build_object('source_table', 'finance_transactions', 'source_row', row.id)
    );
  end loop;
end;
$$;


ALTER FUNCTION "private"."backfill_graph_relations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_manage_project"("target_project_id" "uuid", "target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select target_user_id is not null
    and exists (
      select 1
      from public.projects as p
      where p.id = target_project_id
        and (
          p.created_by = target_user_id
          or p.owner_id = target_user_id
          or private.is_project_member(p.id, target_user_id)
          or private.user_organization_role(p.organization_id, target_user_id) in (
            'owner',
            'admin',
            'manager'
          )
        )
    );
$$;


ALTER FUNCTION "private"."can_manage_project"("target_project_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."can_manage_task"("target_task_id" "uuid", "target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select target_user_id is not null
    and exists (
      select 1
      from public.tasks as t
      where t.id = target_task_id
        and private.is_organization_member(t.organization_id, target_user_id)
    );
$$;


ALTER FUNCTION "private"."can_manage_task"("target_task_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."graph_artifact_type"("artifact_type" "text", "artifact_metadata" "jsonb", "artifact_url" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  select case
    when lower(coalesce(artifact_type, '')) similar to '%(prompt)%' then 'prompt'
    when lower(coalesce(artifact_type, '')) similar to '%(generation|generated|render)%'
      then 'generation'
    when lower(coalesce(artifact_type, '')) similar to '%(design|layout|mockup|figma)%'
      then 'design'
    when lower(coalesce(artifact_type, '')) similar to '%(image|photo|picture)%'
      or lower(coalesce(artifact_url, '')) ~ '\.(png|jpe?g|webp|gif|avif)$'
      then 'image'
    when lower(coalesce(artifact_type, '')) similar to '%(site|website)%' then 'site'
    when lower(coalesce(artifact_type, '')) similar to '%(page|article)%' then 'page'
    when lower(coalesce(artifact_type, '')) similar to '%(decision)%' then 'decision'
    when lower(coalesce(artifact_type, '')) similar to '%(message|email)%' then 'message'
    when lower(coalesce(artifact_type, '')) similar to '%(document|report|text|pdf)%'
      then 'document'
    when artifact_metadata ? 'prompt' then 'prompt'
    else 'file'
  end;
$_$;


ALTER FUNCTION "private"."graph_artifact_type"("artifact_type" "text", "artifact_metadata" "jsonb", "artifact_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."graph_file_type"("file_name" "text", "mime_type" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
  select case
    when lower(coalesce(file_name, '')) ~ '\.(fig|sketch|psd|ai|xd)$' then 'design'
    when lower(coalesce(mime_type, '')) like 'image/%' then 'image'
    when lower(coalesce(mime_type, '')) similar to '%(pdf|word|document|sheet|excel|text)%'
      then 'document'
    else 'file'
  end;
$_$;


ALTER FUNCTION "private"."graph_file_type"("file_name" "text", "mime_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."graph_project_color"("project_name" "text", "project_id" "uuid") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select case
    when lower(coalesce(project_name, '')) similar to '%(aybolit|айболит|лечение за рубежом)%'
      then '#19d5c1'
    when lower(coalesce(project_name, '')) like '%berrdo%'
      then '#dc6fd2'
    when lower(coalesce(project_name, '')) similar to '%(osnova|основа)%'
      then '#62d98b'
    else (array[
      '#55a7e8', '#a77ae6', '#d18bc8', '#66b9a5', '#d2a85d',
      '#6e9fd7', '#bc7f9f', '#78ad72', '#9d91d8', '#4fb6bd'
    ])[1 + (abs(hashtext(coalesce(project_id::text, project_name, 'orbit'))) % 10)]
  end;
$$;


ALTER FUNCTION "private"."graph_project_color"("project_name" "text", "project_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_organization_member"("target_organization_id" "uuid", "target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select target_user_id is not null
    and exists (
      select 1
      from public.organization_members as om
      where om.organization_id = target_organization_id
        and om.user_id = target_user_id
    );
$$;


ALTER FUNCTION "private"."is_organization_member"("target_organization_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."is_project_member"("target_project_id" "uuid", "target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select target_user_id is not null
    and exists (
      select 1
      from public.project_members as pm
      where pm.project_id = target_project_id
        and pm.user_id = target_user_id
    );
$$;


ALTER FUNCTION "private"."is_project_member"("target_project_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."normalize_graph_relation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  source_node public.graph_nodes;
  target_node public.graph_nodes;
begin
  if new.source_node_id is null then
    select node.* into source_node
    from public.graph_nodes node
    where node.organization_id = new.organization_id
      and node.entity_type = new.source_type
      and node.entity_id = new.source_id;
    new.source_node_id := source_node.id;
  else
    select node.* into source_node
    from public.graph_nodes node
    where node.organization_id = new.organization_id and node.id = new.source_node_id;
    new.source_type := source_node.entity_type;
    new.source_id := source_node.entity_id;
  end if;

  if new.target_node_id is null then
    select node.* into target_node
    from public.graph_nodes node
    where node.organization_id = new.organization_id
      and node.entity_type = new.target_type
      and node.entity_id = new.target_id;
    new.target_node_id := target_node.id;
  else
    select node.* into target_node
    from public.graph_nodes node
    where node.organization_id = new.organization_id and node.id = new.target_node_id;
    new.target_type := target_node.entity_type;
    new.target_id := target_node.entity_id;
  end if;

  if source_node.id is null or target_node.id is null or source_node.id = target_node.id then
    raise exception 'Оба узла связи должны существовать в одной организации.' using errcode = '23514';
  end if;

  new.updated_at := now();
  return new;
end;
$$;


ALTER FUNCTION "private"."normalize_graph_relation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."organization_has_members"("target_organization_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.organization_members as om
    where om.organization_id = target_organization_id
  );
$$;


ALTER FUNCTION "private"."organization_has_members"("target_organization_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."storage_object_organization_id"("object_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare
  first_folder text := split_part(coalesce(object_name, ''), '/', 1);
begin
  if first_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return first_folder::uuid;
  end if;

  return null;
end;
$_$;


ALTER FUNCTION "private"."storage_object_organization_id"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_crm_memory_graph"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."sync_crm_memory_graph"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_ai_agent"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes
    where organization_id = old.organization_id and entity_type = 'person' and entity_id = old.id;
    return old;
  end if;
  perform private.upsert_graph_node(
    new.organization_id, 'person', new.id, new.name, null, new.status,
    jsonb_build_object('role', new.role, 'capabilities', new.capabilities, 'kind', 'ai_agent'),
    true, null, new.created_at
  );
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_graph_ai_agent"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_ai_task"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes
    where organization_id = old.organization_id and entity_type = 'task' and entity_id = old.id;
    return old;
  end if;
  perform private.upsert_graph_node(
    new.organization_id, 'task', new.id, new.title, new.project_id, new.status,
    jsonb_build_object('description', new.description, 'source', 'ai_workflow'),
    true, new.created_by, new.created_at
  );
  if new.project_id is not null then
    perform private.upsert_graph_relation(
      new.organization_id, 'project', new.project_id, 'task', new.id,
      'contains', 'one_way', 1, new.created_by,
      jsonb_build_object('source_table', 'ai_tasks', 'source_row', new.id)
    );
  end if;
  if new.agent_id is not null then
    perform private.upsert_graph_relation(
      new.organization_id, 'task', new.id, 'person', new.agent_id,
      'assigned_to', 'one_way', 1, new.created_by,
      jsonb_build_object('source_table', 'ai_tasks', 'source_row', new.id)
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_graph_ai_task"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_artifact"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  node_type text;
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes where organization_id = old.organization_id and entity_id = old.id;
    return old;
  end if;
  node_type := private.graph_artifact_type(new.type, new.metadata, new.url);
  delete from public.graph_nodes
  where organization_id = new.organization_id and entity_id = new.id and entity_type <> node_type;
  perform private.upsert_graph_node(
    new.organization_id, node_type, new.id, new.name, new.project_id, new.type,
    new.metadata || jsonb_build_object('task_id', new.task_id, 'agent_id', new.agent_id, 'url', new.url),
    true, null, new.created_at
  );
  perform private.upsert_graph_relation(
    new.organization_id, 'task', new.task_id, node_type, new.id,
    'created_from', 'one_way', 1, null,
    jsonb_build_object('source_table', 'artifacts', 'source_row', new.id)
  );
  if new.project_id is not null then
    perform private.upsert_graph_relation(
      new.organization_id, node_type, new.id, 'project', new.project_id,
      case when new.metadata ? 'adapted_from_project_id' then 'adapted_for' else 'belongs_to' end,
      'one_way', 1, null,
      jsonb_build_object('source_table', 'artifacts', 'source_row', new.id)
    );
  end if;
  if node_type = 'generation' and (new.metadata ->> 'prompt_id') is not null then
    perform private.upsert_graph_relation(
      new.organization_id, 'prompt', (new.metadata ->> 'prompt_id')::uuid, 'generation', new.id,
      'generated_from_prompt', 'one_way', 1, null,
      jsonb_build_object('source_table', 'artifacts', 'source_row', new.id)
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_graph_artifact"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_checklist_item"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  project uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes
    where organization_id = old.organization_id and entity_type = 'checklist_item' and entity_id = old.id;
    return old;
  end if;
  select task.project_id into project from public.tasks task
  where task.organization_id = new.organization_id and task.id = new.task_id;
  perform private.upsert_graph_node(
    new.organization_id, 'checklist_item', new.id, new.title, project,
    case when new.completed_at is null then 'active' else 'completed' end,
    jsonb_build_object('task_id', new.task_id, 'completed_at', new.completed_at),
    true, new.created_by, new.created_at
  );
  perform private.upsert_graph_relation(
    new.organization_id, 'task', new.task_id, 'checklist_item', new.id,
    'contains', 'one_way', 0.7, new.created_by,
    jsonb_build_object('source_table', 'task_checklist_items', 'source_row', new.id)
  );
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_graph_checklist_item"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_file"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  node_type text;
  project uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes
    where organization_id = old.organization_id and entity_id = old.id
      and entity_type in ('file', 'document', 'image', 'design');
    return old;
  end if;

  node_type := private.graph_file_type(new.file_name, new.mime_type);
  select task.project_id into project
  from public.tasks task
  where task.organization_id = new.organization_id and task.id = new.task_id;

  delete from public.graph_nodes
  where organization_id = new.organization_id and entity_id = new.id
    and entity_type in ('file', 'document', 'image', 'design') and entity_type <> node_type;

  perform private.upsert_graph_node(
    new.organization_id, node_type, new.id, new.file_name, project, null,
    jsonb_build_object(
      'task_id', new.task_id, 'mime_type', new.mime_type,
      'size_bytes', new.size_bytes, 'storage_path', new.storage_path
    ),
    true, new.uploaded_by, new.created_at
  );

  perform private.upsert_graph_relation(
    new.organization_id, 'task', new.task_id, node_type, new.id,
    'created_from', 'one_way', 1, new.uploaded_by,
    jsonb_build_object('source_table', 'files', 'source_row', new.id)
  );
  if project is not null then
    perform private.upsert_graph_relation(
      new.organization_id, node_type, new.id, 'project', project,
      'belongs_to', 'one_way', 1, new.uploaded_by,
      jsonb_build_object('source_table', 'files', 'source_row', new.id)
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_graph_file"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_finance"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  project uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes
    where organization_id = old.organization_id and entity_type = 'finance' and entity_id = old.id;
    return old;
  end if;
  select task.project_id into project from public.tasks task
  where task.organization_id = new.organization_id and task.id = new.task_id;
  perform private.upsert_graph_node(
    new.organization_id, 'finance', new.id, new.label, project, new.type::text,
    jsonb_build_object(
      'task_id', new.task_id, 'amount', new.amount,
      'category', new.category, 'occurred_on', new.occurred_on
    ),
    true, new.created_by, new.created_at
  );
  if new.task_id is not null then
    perform private.upsert_graph_relation(
      new.organization_id, 'task', new.task_id, 'finance', new.id,
      'contains', 'one_way', 0.8, new.created_by,
      jsonb_build_object('source_table', 'finance_transactions', 'source_row', new.id)
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_graph_finance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_organization_member"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  person_title text;
  person_email text;
  person_avatar text;
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes
    where organization_id = old.organization_id and entity_type = 'person' and entity_id = old.user_id;
    return old;
  end if;

  select coalesce(nullif(profile.full_name, ''), nullif(profile.email, ''), 'Участник команды'),
         profile.email, profile.avatar_url
  into person_title, person_email, person_avatar
  from public.profiles profile where profile.id = new.user_id;

  perform private.upsert_graph_node(
    new.organization_id, 'person', new.user_id, coalesce(person_title, 'Участник команды'),
    null, new.role::text,
    jsonb_build_object('role', new.role, 'email', person_email, 'avatar_url', person_avatar),
    true, new.created_by, new.created_at
  );
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_graph_organization_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_project"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."sync_graph_project"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_project_link"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  row_key text;
begin
  if tg_op = 'DELETE' then
    row_key := old.source_project_id::text || ':' || old.target_project_id::text;
  else
    row_key := new.source_project_id::text || ':' || new.target_project_id::text;
  end if;
  delete from public.graph_relations relation
  where relation.is_automatic
    and relation.metadata ->> 'source_table' = 'project_links'
    and relation.metadata ->> 'source_row' = row_key;
  if tg_op <> 'DELETE' then
    perform private.upsert_graph_relation(
      new.organization_id, 'project', new.source_project_id, 'project', new.target_project_id,
      'related_to', 'two_way', 0.85, new.created_by,
      jsonb_build_object('source_table', 'project_links', 'source_row', row_key)
    );
    return new;
  end if;
  return old;
end;
$$;


ALTER FUNCTION "private"."sync_graph_project_link"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_project_member"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  row_key text;
begin
  if tg_op = 'DELETE' then
    row_key := old.project_id::text || ':' || old.user_id::text;
  else
    row_key := new.project_id::text || ':' || new.user_id::text;
  end if;
  delete from public.graph_relations relation
  where relation.is_automatic
    and relation.metadata ->> 'source_table' = 'project_members'
    and relation.metadata ->> 'source_row' = row_key;

  if tg_op <> 'DELETE' then
    perform private.upsert_graph_relation(
      new.organization_id, 'project', new.project_id, 'person', new.user_id,
      'assigned_to', 'two_way', 1, new.created_by,
      jsonb_build_object('source_table', 'project_members', 'source_row', row_key)
    );
    return new;
  end if;
  return old;
end;
$$;


ALTER FUNCTION "private"."sync_graph_project_member"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_task"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  task_node uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes
    where organization_id = old.organization_id and entity_type = 'task' and entity_id = old.id;
    return old;
  end if;

  task_node := private.upsert_graph_node(
    new.organization_id, 'task', new.id, new.title, new.project_id, new.status,
    jsonb_build_object(
      'description', coalesce(new.description, new.note),
      'priority', new.priority,
      'due_date', new.due_date,
      'completed_at', new.completed_at
    ),
    true, new.author_id, new.created_at
  );

  delete from public.graph_relations relation
  where relation.is_automatic
    and relation.metadata ->> 'source_table' = 'tasks'
    and relation.metadata ->> 'source_row' = new.id::text;

  if new.project_id is not null then
    perform private.upsert_graph_relation(
      new.organization_id, 'project', new.project_id, 'task', new.id,
      'contains', 'one_way', 1, new.author_id,
      jsonb_build_object('source_table', 'tasks', 'source_row', new.id)
    );
  end if;

  if new.parent_task_id is not null then
    perform private.upsert_graph_relation(
      new.organization_id, 'task', new.id, 'task', new.parent_task_id,
      'depends_on', 'one_way', 1, new.author_id,
      jsonb_build_object('source_table', 'tasks', 'source_row', new.id)
    );
  end if;

  if new.assignee_id is not null then
    perform private.upsert_graph_relation(
      new.organization_id, 'task', new.id, 'person', new.assignee_id,
      'assigned_to', 'one_way', 1, new.author_id,
      jsonb_build_object('source_table', 'tasks', 'source_row', new.id)
    );
  end if;

  if new.author_id is not null then
    perform private.upsert_graph_relation(
      new.organization_id, 'task', new.id, 'person', new.author_id,
      'created_by', 'one_way', 0.7, new.author_id,
      jsonb_build_object('source_table', 'tasks', 'source_row', new.id)
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_graph_task"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_task_assignee"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  row_key text;
begin
  if tg_op = 'DELETE' then
    row_key := old.task_id::text || ':' || old.user_id::text;
  else
    row_key := new.task_id::text || ':' || new.user_id::text;
  end if;
  delete from public.graph_relations relation
  where relation.is_automatic
    and relation.metadata ->> 'source_table' = 'task_assignees'
    and relation.metadata ->> 'source_row' = row_key;
  if tg_op <> 'DELETE' then
    perform private.upsert_graph_relation(
      new.organization_id, 'task', new.task_id, 'person', new.user_id,
      'assigned_to', 'one_way', 1, new.created_by,
      jsonb_build_object('source_table', 'task_assignees', 'source_row', row_key)
    );
    return new;
  end if;
  return old;
end;
$$;


ALTER FUNCTION "private"."sync_graph_task_assignee"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."sync_graph_task_comment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  project uuid;
begin
  if tg_op = 'DELETE' then
    delete from public.graph_nodes
    where organization_id = old.organization_id and entity_type = 'message' and entity_id = old.id;
    return old;
  end if;
  select task.project_id into project from public.tasks task
  where task.organization_id = new.organization_id and task.id = new.task_id;
  perform private.upsert_graph_node(
    new.organization_id, 'message', new.id,
    left(regexp_replace(new.body, '\s+', ' ', 'g'), 500), project, null,
    jsonb_build_object('task_id', new.task_id, 'kind', 'task_comment'),
    true, new.created_by, new.created_at
  );
  perform private.upsert_graph_relation(
    new.organization_id, 'task', new.task_id, 'message', new.id,
    'contains', 'one_way', 0.7, new.created_by,
    jsonb_build_object('source_table', 'task_comments', 'source_row', new.id)
  );
  return new;
end;
$$;


ALTER FUNCTION "private"."sync_graph_task_comment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."upsert_graph_node"("p_organization_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_title" "text", "p_project_id" "uuid", "p_status" "text", "p_metadata" "jsonb", "p_is_automatic" boolean, "p_created_by" "uuid", "p_created_at" timestamp with time zone, "p_position_x" double precision DEFAULT NULL::double precision, "p_position_y" double precision DEFAULT NULL::double precision) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  node_id uuid;
  normalized_title text := left(coalesce(nullif(trim(p_title), ''), 'Без названия'), 500);
  fallback_creator uuid;
  automatic_x double precision := p_position_x;
  automatic_y double precision := p_position_y;
  project_count integer;
begin
  select coalesce(p_created_by, organization.created_by)
  into fallback_creator
  from public.organizations organization
  where organization.id = p_organization_id;

  if p_entity_type = 'project' and automatic_x is null then
    select count(*)::integer into project_count
    from public.graph_nodes node
    where node.organization_id = p_organization_id and node.entity_type = 'project';
    automatic_x := 180 + (project_count % 4) * 310;
    automatic_y := 120 + (project_count / 4) * 260;
  end if;

  insert into public.graph_nodes (
    organization_id, entity_type, entity_id, title, project_id, status,
    metadata, position_x, position_y, is_automatic, created_by, created_at
  )
  values (
    p_organization_id, p_entity_type, p_entity_id, normalized_title, p_project_id,
    nullif(p_status, ''), coalesce(p_metadata, '{}'::jsonb), automatic_x, automatic_y,
    p_is_automatic, fallback_creator, coalesce(p_created_at, now())
  )
  on conflict (organization_id, entity_type, entity_id) do update
  set title = excluded.title,
      project_id = excluded.project_id,
      status = excluded.status,
      metadata = public.graph_nodes.metadata || excluded.metadata,
      position_x = coalesce(public.graph_nodes.position_x, excluded.position_x),
      position_y = coalesce(public.graph_nodes.position_y, excluded.position_y),
      updated_at = now()
  returning id into node_id;

  return node_id;
end;
$$;


ALTER FUNCTION "private"."upsert_graph_node"("p_organization_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_title" "text", "p_project_id" "uuid", "p_status" "text", "p_metadata" "jsonb", "p_is_automatic" boolean, "p_created_by" "uuid", "p_created_at" timestamp with time zone, "p_position_x" double precision, "p_position_y" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."upsert_graph_relation"("p_organization_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_target_type" "text", "p_target_id" "uuid", "p_relation_type" "text", "p_direction" "text", "p_strength" real, "p_created_by" "uuid", "p_metadata" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  source_node uuid;
  target_node uuid;
  relation_id uuid;
  fallback_creator uuid;
begin
  select node.id into source_node
  from public.graph_nodes node
  where node.organization_id = p_organization_id
    and node.entity_type = p_source_type
    and node.entity_id = p_source_id;

  select node.id into target_node
  from public.graph_nodes node
  where node.organization_id = p_organization_id
    and node.entity_type = p_target_type
    and node.entity_id = p_target_id;

  if source_node is null or target_node is null or source_node = target_node then
    return null;
  end if;

  select coalesce(p_created_by, organization.created_by)
  into fallback_creator
  from public.organizations organization
  where organization.id = p_organization_id;

  insert into public.graph_relations (
    organization_id, source_node_id, target_node_id,
    source_type, source_id, target_type, target_id,
    relation_type, direction, strength, is_automatic, created_by, metadata
  )
  values (
    p_organization_id, source_node, target_node,
    p_source_type, p_source_id, p_target_type, p_target_id,
    p_relation_type, coalesce(p_direction, 'one_way'), coalesce(p_strength, 1),
    true, fallback_creator, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (
    organization_id, source_node_id, target_node_id, relation_type, direction
  ) do update
  set strength = excluded.strength,
      metadata = public.graph_relations.metadata || excluded.metadata,
      updated_at = now()
  returning id into relation_id;

  return relation_id;
end;
$$;


ALTER FUNCTION "private"."upsert_graph_relation"("p_organization_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_target_type" "text", "p_target_id" "uuid", "p_relation_type" "text", "p_direction" "text", "p_strength" real, "p_created_by" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."user_organization_role"("target_organization_id" "uuid", "target_user_id" "uuid") RETURNS "public"."organization_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select om.role
  from public.organization_members as om
  where om.organization_id = target_organization_id
    and om.user_id = target_user_id
  limit 1;
$$;


ALTER FUNCTION "private"."user_organization_role"("target_organization_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."users_share_organization"("left_user_id" "uuid", "right_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select left_user_id is not null
    and right_user_id is not null
    and exists (
      select 1
      from public.organization_members as left_member
      join public.organization_members as right_member
        on right_member.organization_id = left_member.organization_id
      where left_member.user_id = left_user_id
        and right_member.user_id = right_user_id
    );
$$;


ALTER FUNCTION "private"."users_share_organization"("left_user_id" "uuid", "right_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_knowledge_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."apply_knowledge_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_openclaw_task_webhook"("p_task_id" "uuid", "p_idempotency_key" "text", "p_payload_digest" "text", "p_status" "text", "p_result" "jsonb" DEFAULT NULL::"jsonb", "p_error" "text" DEFAULT NULL::"text") RETURNS TABLE("applied" boolean, "duplicate" boolean, "organization_id" "uuid", "correlation_id" "uuid", "current_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  task_row public.openclaw_tasks%rowtype;
  event_id bigint;
  should_apply boolean;
begin
  if p_status not in ('pending','queued','processing','completed','error','cancelled') then
    raise exception 'Invalid OpenClaw task status' using errcode = '22023';
  end if;
  if char_length(p_idempotency_key) not between 8 and 200 or char_length(p_payload_digest) <> 64 then
    raise exception 'Invalid webhook idempotency metadata' using errcode = '22023';
  end if;

  select * into task_row from public.openclaw_tasks where id = p_task_id for update;
  if not found then return; end if;

  insert into private.openclaw_webhook_events(
    organization_id, task_id, idempotency_key, payload_digest, requested_status
  ) values (
    task_row.organization_id, p_task_id, p_idempotency_key, p_payload_digest, p_status
  ) on conflict (task_id, idempotency_key) do nothing
  returning id into event_id;

  if event_id is null then
    return query select false, true, task_row.organization_id,
      task_row.correlation_id, task_row.status;
    return;
  end if;

  should_apply := task_row.status not in ('completed','error','cancelled');
  if should_apply then
    update public.openclaw_tasks
    set status = p_status,
        result = case when p_result is not null then p_result else result end,
        error = case when p_error is not null then p_error else error end,
        updated_at = now()
    where id = p_task_id;
    update private.openclaw_webhook_events set applied = true where id = event_id;
  end if;

  return query select should_apply, false, task_row.organization_id,
    task_row.correlation_id, case when should_apply then p_status else task_row.status end;
end;
$$;


ALTER FUNCTION "public"."apply_openclaw_task_webhook"("p_task_id" "uuid", "p_idempotency_key" "text", "p_payload_digest" "text", "p_status" "text", "p_result" "jsonb", "p_error" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "title" "text" NOT NULL,
    "note" "text",
    "status" "text" DEFAULT 'backlog'::"text" NOT NULL,
    "priority" "public"."task_priority" DEFAULT 'med'::"public"."task_priority" NOT NULL,
    "due_date" "date",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "parent_task_id" "uuid",
    "description" "text",
    "start_date" "date",
    "estimated_minutes" integer,
    "actual_minutes" integer DEFAULT 0 NOT NULL,
    "assignee_id" "uuid",
    "author_id" "uuid" NOT NULL,
    "expected_revenue" numeric(14,2),
    "internal_cost" numeric(14,2),
    "currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "sort_order" numeric(14,4) DEFAULT 0 NOT NULL,
    "completed_at" timestamp with time zone,
    "archived_at" timestamp with time zone,
    CONSTRAINT "tasks_completed_timestamp_check" CHECK ((("status" = 'completed'::"text") = ("completed_at" IS NOT NULL))),
    CONSTRAINT "tasks_currency_format_check" CHECK (("currency" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "tasks_date_order_check" CHECK ((("due_date" IS NULL) OR ("start_date" IS NULL) OR ("due_date" >= "start_date"))),
    CONSTRAINT "tasks_nonnegative_numbers_check" CHECK (((("estimated_minutes" IS NULL) OR ("estimated_minutes" >= 0)) AND ("actual_minutes" >= 0) AND (("expected_revenue" IS NULL) OR ("expected_revenue" >= (0)::numeric)) AND (("internal_cost" IS NULL) OR ("internal_cost" >= (0)::numeric)) AND ("sort_order" >= (0)::numeric))),
    CONSTRAINT "tasks_parent_not_self_check" CHECK ((("parent_task_id" IS NULL) OR ("parent_task_id" <> "id"))),
    CONSTRAINT "tasks_status_allowed_check" CHECK (("status" = ANY (ARRAY['backlog'::"text", 'planned'::"text", 'in_progress'::"text", 'review'::"text", 'blocked'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "tasks_title_check" CHECK (("char_length"(TRIM(BOTH FROM "title")) > 0))
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tasks"."organization_id" IS 'Required tenant boundary column for business entities.';



COMMENT ON COLUMN "public"."tasks"."status" IS 'Task lifecycle status stored as an untranslated key.';



COMMENT ON COLUMN "public"."tasks"."created_by" IS 'Auth user who created this business entity.';



COMMENT ON COLUMN "public"."tasks"."parent_task_id" IS 'Optional self-reference for subtasks.';



COMMENT ON COLUMN "public"."tasks"."completed_at" IS 'Set automatically when status becomes completed and cleared when work resumes.';



COMMENT ON COLUMN "public"."tasks"."archived_at" IS 'Soft archive marker. Tasks with children or financial operations should be archived instead of physically deleted.';



CREATE OR REPLACE FUNCTION "public"."archive_task"("p_task_id" "uuid") RETURNS "public"."tasks"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid := (select auth.uid());
  archived_task public.tasks;
begin
  if actor_id is null then
    raise exception 'Необходима авторизация.' using errcode = '42501';
  end if;

  if not private.can_manage_task(p_task_id, actor_id) then
    raise exception 'Нет доступа к задаче.' using errcode = '42501';
  end if;

  update public.tasks
  set archived_at = coalesce(archived_at, now())
  where id = p_task_id
  returning * into archived_task;

  if archived_task.id is null then
    raise exception 'Задача не найдена.' using errcode = 'P0002';
  end if;

  return archived_task;
end;
$$;


ALTER FUNCTION "public"."archive_task"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_knowledge_entry"("p_organization_id" "uuid", "p_slug" "text", "p_title" "text", "p_category" "text", "p_content" "jsonb", "p_created_by" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."create_knowledge_entry"("p_organization_id" "uuid", "p_slug" "text", "p_title" "text", "p_category" "text", "p_content" "jsonb", "p_created_by" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT 'var(--acc-1)'::"text" NOT NULL,
    "x_position" numeric(5,2) DEFAULT 50 NOT NULL,
    "y_position" numeric(5,2) DEFAULT 50 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "description" "text",
    "status" "public"."project_status" DEFAULT 'planned'::"public"."project_status" NOT NULL,
    "priority" "public"."project_priority" DEFAULT 'medium'::"public"."project_priority" NOT NULL,
    "start_date" "date",
    "due_date" "date",
    "owner_id" "uuid",
    "budget_planned" numeric(14,2),
    "currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "archived_at" timestamp with time zone,
    CONSTRAINT "projects_archived_status_check" CHECK ((("status" = 'archived'::"public"."project_status") = ("archived_at" IS NOT NULL))),
    CONSTRAINT "projects_budget_planned_nonnegative_check" CHECK ((("budget_planned" IS NULL) OR ("budget_planned" >= (0)::numeric))),
    CONSTRAINT "projects_currency_format_check" CHECK (("currency" ~ '^[A-Z]{3}$'::"text")),
    CONSTRAINT "projects_date_order_check" CHECK ((("due_date" IS NULL) OR ("start_date" IS NULL) OR ("due_date" >= "start_date"))),
    CONSTRAINT "projects_name_check" CHECK (("char_length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "projects_x_position_check" CHECK ((("x_position" >= (0)::numeric) AND ("x_position" <= (100)::numeric))),
    CONSTRAINT "projects_y_position_check" CHECK ((("y_position" >= (0)::numeric) AND ("y_position" <= (100)::numeric)))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


COMMENT ON COLUMN "public"."projects"."organization_id" IS 'Required tenant boundary column for business entities.';



COMMENT ON COLUMN "public"."projects"."created_by" IS 'Auth user who created this business entity.';



COMMENT ON COLUMN "public"."projects"."status" IS 'Lifecycle status for a CRM project.';



COMMENT ON COLUMN "public"."projects"."priority" IS 'Business priority for a CRM project.';



COMMENT ON COLUMN "public"."projects"."archived_at" IS 'Soft archive marker. Projects are not physically deleted by the app.';



CREATE OR REPLACE FUNCTION "public"."create_project"("p_organization_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_status" "public"."project_status", "p_priority" "public"."project_priority", "p_start_date" "date", "p_due_date" "date", "p_owner_id" "uuid", "p_budget_planned" numeric, "p_currency" "text", "p_member_ids" "uuid"[]) RETURNS "public"."projects"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  actor_id uuid := (select auth.uid());
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_color text := coalesce(nullif(trim(coalesce(p_color, '')), ''), 'var(--acc-1)');
  normalized_status public.project_status := coalesce(p_status, 'planned'::public.project_status);
  normalized_priority public.project_priority := coalesce(p_priority, 'medium'::public.project_priority);
  normalized_currency text := upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'EUR'));
  normalized_owner_id uuid := coalesce(p_owner_id, actor_id);
  normalized_members uuid[];
  created_project public.projects;
begin
  if actor_id is null then
    raise exception 'Необходима авторизация.' using errcode = '42501';
  end if;

  if not private.is_organization_member(p_organization_id, actor_id) then
    raise exception 'Нет доступа к организации.' using errcode = '42501';
  end if;

  if normalized_name = '' then
    raise exception 'Название проекта обязательно.' using errcode = '22023';
  end if;

  if p_start_date is not null and p_due_date is not null and p_due_date < p_start_date then
    raise exception 'Дата завершения не может быть раньше даты начала.' using errcode = '22023';
  end if;

  if p_budget_planned is not null and p_budget_planned < 0 then
    raise exception 'Плановый бюджет не может быть отрицательным.' using errcode = '22023';
  end if;

  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Валюта должна быть трёхбуквенным ISO-кодом.' using errcode = '22023';
  end if;

  if normalized_owner_id is not null
    and not private.is_organization_member(p_organization_id, normalized_owner_id) then
    raise exception 'Владелец проекта должен быть участником организации.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
  into normalized_members
  from (
    select unnest(
      coalesce(p_member_ids, '{}'::uuid[]) || array[normalized_owner_id, actor_id]
    ) as member_id
  ) as raw_members
  where member_id is not null;

  if exists (
    select 1
    from unnest(normalized_members) as selected_member(member_id)
    where not private.is_organization_member(p_organization_id, selected_member.member_id)
  ) then
    raise exception 'Все участники проекта должны входить в организацию.' using errcode = '22023';
  end if;

  insert into public.projects (
    organization_id,
    name,
    description,
    color,
    status,
    priority,
    start_date,
    due_date,
    owner_id,
    budget_planned,
    currency,
    created_by,
    archived_at
  )
  values (
    p_organization_id,
    normalized_name,
    nullif(trim(coalesce(p_description, '')), ''),
    normalized_color,
    normalized_status,
    normalized_priority,
    p_start_date,
    p_due_date,
    normalized_owner_id,
    p_budget_planned,
    normalized_currency,
    actor_id,
    case when normalized_status = 'archived' then now() else null end
  )
  returning * into created_project;

  insert into public.project_members (project_id, organization_id, user_id, created_by)
  select created_project.id, created_project.organization_id, member_id, actor_id
  from unnest(normalized_members) as selected_member(member_id)
  on conflict do nothing;

  return created_project;
end;
$_$;


ALTER FUNCTION "public"."create_project"("p_organization_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_status" "public"."project_status", "p_priority" "public"."project_priority", "p_start_date" "date", "p_due_date" "date", "p_owner_id" "uuid", "p_budget_planned" numeric, "p_currency" "text", "p_member_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_task"("p_task_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  actor_id uuid := (select auth.uid());
  target_organization_id uuid;
  child_count bigint;
  finance_count bigint;
begin
  if actor_id is null then
    raise exception 'Необходима авторизация.' using errcode = '42501';
  end if;

  select t.organization_id
  into target_organization_id
  from public.tasks as t
  where t.id = p_task_id;

  if target_organization_id is null then
    raise exception 'Задача не найдена.' using errcode = 'P0002';
  end if;

  if not private.can_manage_task(p_task_id, actor_id) then
    raise exception 'Нет доступа к задаче.' using errcode = '42501';
  end if;

  select count(*)
  into child_count
  from public.tasks as child_task
  where child_task.organization_id = target_organization_id
    and child_task.parent_task_id = p_task_id;

  select count(*)
  into finance_count
  from public.finance_transactions as tx
  where tx.organization_id = target_organization_id
    and tx.task_id = p_task_id;

  if child_count > 0 or finance_count > 0 then
    raise exception 'TASK_ARCHIVE_REQUIRED: У задачи есть дочерние задачи или финансовые операции. Архивируйте её вместо удаления.'
      using errcode = 'P0001';
  end if;

  delete from public.tasks
  where id = p_task_id;
end;
$$;


ALTER FUNCTION "public"."delete_task"("p_task_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_lead_clients_by_city"("p_user_id" "uuid", "p_status" "text" DEFAULT NULL::"text") RETURNS TABLE("city_location" "text", "clients" "jsonb", "client_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO ''
    AS $$
  select lc.city_location,
    jsonb_agg(to_jsonb(lc) order by lc.priority, lc.business_name) as clients,
    count(*) as client_count
  from public.lead_clients lc
  where lc.user_id = p_user_id
    and (p_status is null or lc.status::text = p_status)
  group by lc.city_location
  order by lc.city_location;
$$;


ALTER FUNCTION "public"."get_lead_clients_by_city"("p_user_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
        updated_at = now();

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prepare_calendar_event_reminder"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if tg_op = 'UPDATE'
     and new.starts_at is distinct from old.starts_at
     and new.reminder_at is not null
     and new.reminder_at is not distinct from old.reminder_at then
    new.reminder_at := new.reminder_at + (new.starts_at - old.starts_at);
  end if;
  if tg_op = 'INSERT'
     or new.reminder_at is distinct from old.reminder_at
     or new.status is distinct from old.status then
    new.reminder_sent_at := null;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."prepare_calendar_event_reminder"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_due_calendar_reminders"("p_limit" integer DEFAULT 100) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  processed_count integer;
begin
  if p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000';
  end if;

  with due as (
    select r.id
      from public.calendar_reminders r
      join public.calendar_events e on e.id = r.event_id
     where r.status = 'queued'
       and r.scheduled_for <= now()
       and e.status <> 'cancelled'
     order by r.scheduled_for, r.id
     for update of r skip locked
     limit p_limit
  ), updated as (
    update public.calendar_reminders r
       set status = 'delivered',
           attempt_count = r.attempt_count + 1,
           delivered_at = now(),
           last_error = null,
           updated_at = now()
      from due
     where r.id = due.id
    returning r.*
  ), logged as (
    insert into public.calendar_reminder_deliveries (
      organization_id, reminder_id, event_id, channel, attempt_number, status, delivered_at
    )
    select organization_id, id, event_id, channel, attempt_count, 'delivered', delivered_at
      from updated
    on conflict (reminder_id, attempt_number) do nothing
    returning reminder_id
  ), marked as (
    update public.calendar_events e
       set reminder_sent_at = u.delivered_at
      from updated u
     where e.id = u.event_id
    returning e.id
  )
  select count(*) into processed_count from logged;

  return processed_count;
end;
$$;


ALTER FUNCTION "public"."process_due_calendar_reminders"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."review_improvement_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid", "p_decision" "text", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."review_improvement_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid", "p_decision" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollback_knowledge_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."rollback_knowledge_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_task_status_timestamps"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at = coalesce(new.completed_at, now());
    else
      new.completed_at = coalesce(new.completed_at, old.completed_at, now());
    end if;
  else
    new.completed_at = null;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."set_task_status_timestamps"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin new.updated_at = now(); return new; end $$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_calendar_event_reminder"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.reminder_at is null or new.status = 'cancelled' then
    update public.calendar_reminders
       set status = 'cancelled', updated_at = now()
     where event_id = new.id
       and status in ('queued','processing','failed');
    return new;
  end if;
  if tg_op = 'INSERT'
     or new.reminder_at is distinct from old.reminder_at
     or (new.status is distinct from old.status and old.status = 'cancelled') then
    insert into public.calendar_reminders (organization_id,event_id,channel,scheduled_for,status)
    values (new.organization_id,new.id,'in_app',new.reminder_at,'queued')
    on conflict (event_id,channel) do update
      set organization_id=excluded.organization_id,
          scheduled_for=excluded.scheduled_for,
          status='queued', attempt_count=0, last_error=null,
          delivered_at=null, updated_at=now();
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_calendar_event_reminder"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_project"("p_project_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_status" "public"."project_status", "p_priority" "public"."project_priority", "p_start_date" "date", "p_due_date" "date", "p_owner_id" "uuid", "p_budget_planned" numeric, "p_currency" "text", "p_member_ids" "uuid"[]) RETURNS "public"."projects"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  actor_id uuid := (select auth.uid());
  target_organization_id uuid;
  normalized_name text := trim(coalesce(p_name, ''));
  normalized_color text := coalesce(nullif(trim(coalesce(p_color, '')), ''), 'var(--acc-1)');
  normalized_status public.project_status := coalesce(p_status, 'planned'::public.project_status);
  normalized_priority public.project_priority := coalesce(p_priority, 'medium'::public.project_priority);
  normalized_currency text := upper(coalesce(nullif(trim(coalesce(p_currency, '')), ''), 'EUR'));
  normalized_owner_id uuid := coalesce(p_owner_id, actor_id);
  normalized_members uuid[];
  updated_project public.projects;
begin
  if actor_id is null then
    raise exception 'Необходима авторизация.' using errcode = '42501';
  end if;

  select p.organization_id
  into target_organization_id
  from public.projects as p
  where p.id = p_project_id;

  if target_organization_id is null then
    raise exception 'Проект не найден.' using errcode = 'P0002';
  end if;

  if not private.can_manage_project(p_project_id, actor_id) then
    raise exception 'Нет доступа к изменению проекта.' using errcode = '42501';
  end if;

  if normalized_name = '' then
    raise exception 'Название проекта обязательно.' using errcode = '22023';
  end if;

  if p_start_date is not null and p_due_date is not null and p_due_date < p_start_date then
    raise exception 'Дата завершения не может быть раньше даты начала.' using errcode = '22023';
  end if;

  if p_budget_planned is not null and p_budget_planned < 0 then
    raise exception 'Плановый бюджет не может быть отрицательным.' using errcode = '22023';
  end if;

  if normalized_currency !~ '^[A-Z]{3}$' then
    raise exception 'Валюта должна быть трёхбуквенным ISO-кодом.' using errcode = '22023';
  end if;

  if normalized_owner_id is not null
    and not private.is_organization_member(target_organization_id, normalized_owner_id) then
    raise exception 'Владелец проекта должен быть участником организации.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct member_id), '{}'::uuid[])
  into normalized_members
  from (
    select unnest(
      coalesce(p_member_ids, '{}'::uuid[]) || array[normalized_owner_id, actor_id]
    ) as member_id
  ) as raw_members
  where member_id is not null;

  if exists (
    select 1
    from unnest(normalized_members) as selected_member(member_id)
    where not private.is_organization_member(target_organization_id, selected_member.member_id)
  ) then
    raise exception 'Все участники проекта должны входить в организацию.' using errcode = '22023';
  end if;

  delete from public.project_members
  where project_id = p_project_id
    and not (user_id = any(normalized_members));

  insert into public.project_members (project_id, organization_id, user_id, created_by)
  select p_project_id, target_organization_id, member_id, actor_id
  from unnest(normalized_members) as selected_member(member_id)
  on conflict do nothing;

  update public.projects
  set name = normalized_name,
      description = nullif(trim(coalesce(p_description, '')), ''),
      color = normalized_color,
      status = normalized_status,
      priority = normalized_priority,
      start_date = p_start_date,
      due_date = p_due_date,
      owner_id = normalized_owner_id,
      budget_planned = p_budget_planned,
      currency = normalized_currency,
      archived_at = case
        when normalized_status = 'archived' then coalesce(archived_at, now())
        else null
      end
  where id = p_project_id
  returning * into updated_project;

  if updated_project.id is null then
    raise exception 'Проект не найден или недоступен.' using errcode = 'P0002';
  end if;

  return updated_project;
end;
$_$;


ALTER FUNCTION "public"."update_project"("p_project_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_status" "public"."project_status", "p_priority" "public"."project_priority", "p_start_date" "date", "p_due_date" "date", "p_owner_id" "uuid", "p_budget_planned" numeric, "p_currency" "text", "p_member_ids" "uuid"[]) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."openclaw_webhook_events" (
    "id" bigint NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "payload_digest" "text" NOT NULL,
    "requested_status" "text" NOT NULL,
    "applied" boolean DEFAULT false NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "openclaw_webhook_events_idempotency_key_check" CHECK ((("char_length"("idempotency_key") >= 8) AND ("char_length"("idempotency_key") <= 200))),
    CONSTRAINT "openclaw_webhook_events_payload_digest_check" CHECK (("char_length"("payload_digest") = 64))
);


ALTER TABLE "private"."openclaw_webhook_events" OWNER TO "postgres";


ALTER TABLE "private"."openclaw_webhook_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "private"."openclaw_webhook_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_action_audit" (
    "id" bigint NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "risk_level" "text" DEFAULT 'low'::"text" NOT NULL,
    "status" "text" NOT NULL,
    "input_summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "output_summary" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "correlation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "ai_action_audit_risk_level_check" CHECK (("risk_level" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "ai_action_audit_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'approved'::"text", 'rejected'::"text", 'executed'::"text", 'failed'::"text", 'rolled_back'::"text"])))
);


ALTER TABLE "public"."ai_action_audit" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ai_action_audit"."correlation_id" IS 'Request correlation identifier for tracing an AI action across Vercel, backend, OpenClaw and Supabase.';



ALTER TABLE "public"."ai_action_audit" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_action_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_improvement_proposal_events" (
    "id" bigint NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "proposal_id" "uuid" NOT NULL,
    "previous_status" "text",
    "new_status" "text" NOT NULL,
    "actor_id" "uuid",
    "reason" "text",
    "proposal_snapshot" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ai_improvement_proposal_events" OWNER TO "postgres";


ALTER TABLE "public"."ai_improvement_proposal_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_improvement_proposal_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_improvement_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "knowledge_id" "uuid",
    "title" "text" NOT NULL,
    "rationale" "text" NOT NULL,
    "evidence" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "proposed_content" "jsonb" NOT NULL,
    "risk_level" "text" DEFAULT 'medium'::"text" NOT NULL,
    "confidence" numeric(3,2),
    "status" "text" DEFAULT 'pending_review'::"text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "applied_version" integer,
    "rollback_version" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "review_note" "text",
    "proposal_version" integer DEFAULT 1 NOT NULL,
    "supersedes_proposal_id" "uuid",
    CONSTRAINT "ai_improvement_proposals_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "ai_improvement_proposals_proposal_version_check" CHECK (("proposal_version" > 0)),
    CONSTRAINT "ai_improvement_proposals_risk_level_check" CHECK (("risk_level" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "ai_improvement_proposals_status_check" CHECK (("status" = ANY (ARRAY['pending_review'::"text", 'approved'::"text", 'rejected'::"text", 'applied'::"text", 'rolled_back'::"text"]))),
    CONSTRAINT "ai_improvement_proposals_target_type_check" CHECK (("target_type" = ANY (ARRAY['knowledge'::"text", 'template'::"text", 'business_process'::"text"]))),
    CONSTRAINT "ai_improvement_proposals_title_check" CHECK ((("char_length"(TRIM(BOTH FROM "title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "title")) <= 240)))
);


ALTER TABLE "public"."ai_improvement_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_outcomes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "interaction_id" "uuid",
    "action_type" "text" NOT NULL,
    "recommendation" "text",
    "outcome" "text" NOT NULL,
    "score" numeric(5,2),
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "recorded_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_outcomes_outcome_check" CHECK (("outcome" = ANY (ARRAY['successful'::"text", 'unsuccessful'::"text", 'neutral'::"text", 'unknown'::"text"])))
);


ALTER TABLE "public"."ai_outcomes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_user_memory" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid",
    "key_phrase" "text" NOT NULL,
    "memory_value" "jsonb" NOT NULL,
    "confidence" numeric(3,2) DEFAULT 0.80 NOT NULL,
    "source" "text" DEFAULT 'user'::"text" NOT NULL,
    "approved_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "last_verified_at" timestamp with time zone,
    "correction_note" "text",
    "corrected_by" "uuid",
    CONSTRAINT "ai_user_memory_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric))),
    CONSTRAINT "ai_user_memory_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['project'::"text", 'task'::"text", 'contact'::"text", 'client'::"text", 'company'::"text", 'synonym'::"text", 'preference'::"text", 'outcome'::"text"]))),
    CONSTRAINT "ai_user_memory_key_phrase_check" CHECK ((("char_length"(TRIM(BOTH FROM "key_phrase")) >= 1) AND ("char_length"(TRIM(BOTH FROM "key_phrase")) <= 500))),
    CONSTRAINT "ai_user_memory_source_check" CHECK (("source" = ANY (ARRAY['user'::"text", 'crm'::"text", 'openclaw'::"text", 'import'::"text"])))
);


ALTER TABLE "public"."ai_user_memory" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_user_memory_revisions" (
    "id" bigint NOT NULL,
    "memory_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "memory_value" "jsonb" NOT NULL,
    "confidence" numeric(3,2) NOT NULL,
    "source" "text" NOT NULL,
    "correction_note" "text",
    "changed_by" "uuid",
    "replaced_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_user_memory_revisions_confidence_check" CHECK ((("confidence" >= (0)::numeric) AND ("confidence" <= (1)::numeric)))
);


ALTER TABLE "public"."ai_user_memory_revisions" OWNER TO "postgres";


ALTER TABLE "public"."ai_user_memory_revisions" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_user_memory_revisions_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."calendar_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "deal_id" "uuid",
    "task_id" "uuid",
    "title" "text" NOT NULL,
    "client_name" "text" DEFAULT ''::"text" NOT NULL,
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "reminder_at" timestamp with time zone,
    "reminder_sent_at" timestamp with time zone,
    "notes" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "calendar_events_check" CHECK (("ends_at" > "starts_at")),
    CONSTRAINT "calendar_events_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'pending'::"text", 'confirmed'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "calendar_events_title_check" CHECK ((("char_length"(TRIM(BOTH FROM "title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "title")) <= 240)))
);


ALTER TABLE "public"."calendar_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."calendar_reminder_deliveries" (
    "id" bigint NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "reminder_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "channel" "text" NOT NULL,
    "attempt_number" integer NOT NULL,
    "status" "text" NOT NULL,
    "error" "text",
    "delivered_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "calendar_reminder_deliveries_attempt_number_check" CHECK (("attempt_number" > 0)),
    CONSTRAINT "calendar_reminder_deliveries_channel_check" CHECK (("channel" = 'in_app'::"text")),
    CONSTRAINT "calendar_reminder_deliveries_status_check" CHECK (("status" = ANY (ARRAY['delivered'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."calendar_reminder_deliveries" OWNER TO "postgres";


ALTER TABLE "public"."calendar_reminder_deliveries" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."calendar_reminder_deliveries_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."calendar_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "channel" "text" DEFAULT 'in_app'::"text" NOT NULL,
    "scheduled_for" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "delivered_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "calendar_reminders_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "calendar_reminders_channel_check" CHECK (("channel" = 'in_app'::"text")),
    CONSTRAINT "calendar_reminders_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'delivered'::"text", 'cancelled'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."calendar_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_interactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "deal_id" "uuid",
    "interaction_type" "text" NOT NULL,
    "direction" "text",
    "subject" "text",
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "client_interactions_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text", 'internal'::"text"]))),
    CONSTRAINT "client_interactions_interaction_type_check" CHECK (("interaction_type" = ANY (ARRAY['note'::"text", 'email'::"text", 'call'::"text", 'meeting'::"text", 'message'::"text", 'status_change'::"text"]))),
    CONSTRAINT "client_interactions_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text"))
);


ALTER TABLE "public"."client_interactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."communication_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "channel" "text" NOT NULL,
    "direction" "text" NOT NULL,
    "action" "text" NOT NULL,
    "status" "text" NOT NULL,
    "provider_message_id" "text",
    "idempotency_key" "text" NOT NULL,
    "recipient" "text",
    "subject" "text",
    "source" "text" DEFAULT 'user'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error" "text",
    "confirmed_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "communication_events_action_check" CHECK (("action" = ANY (ARRAY['send'::"text", 'reply'::"text", 'webhook'::"text", 'classify'::"text", 'create_task'::"text"]))),
    CONSTRAINT "communication_events_channel_check" CHECK (("channel" = ANY (ARRAY['email'::"text", 'telegram'::"text"]))),
    CONSTRAINT "communication_events_direction_check" CHECK (("direction" = ANY (ARRAY['inbound'::"text", 'outbound'::"text"]))),
    CONSTRAINT "communication_events_idempotency_key_check" CHECK ((("char_length"("idempotency_key") >= 8) AND ("char_length"("idempotency_key") <= 240))),
    CONSTRAINT "communication_events_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
    CONSTRAINT "communication_events_source_check" CHECK (("source" = ANY (ARRAY['user'::"text", 'openclaw'::"text", 'automation'::"text", 'provider_webhook'::"text"]))),
    CONSTRAINT "communication_events_status_check" CHECK (("status" = ANY (ARRAY['processing'::"text", 'sent'::"text", 'received'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."communication_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_knowledge" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "current_version" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "company_knowledge_current_version_check" CHECK (("current_version" >= 0)),
    CONSTRAINT "company_knowledge_slug_check" CHECK (("slug" ~ '^[a-z0-9][a-z0-9_-]{1,119}$'::"text")),
    CONSTRAINT "company_knowledge_title_check" CHECK ((("char_length"(TRIM(BOTH FROM "title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "title")) <= 240)))
);


ALTER TABLE "public"."company_knowledge" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_knowledge_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "knowledge_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "content" "jsonb" NOT NULL,
    "change_summary" "text" NOT NULL,
    "source" "text" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "company_knowledge_versions_source_check" CHECK (("source" = ANY (ARRAY['human'::"text", 'approved_ai_proposal'::"text", 'rollback'::"text", 'import'::"text"]))),
    CONSTRAINT "company_knowledge_versions_version_check" CHECK (("version" > 0))
);


ALTER TABLE "public"."company_knowledge_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "project_id" "uuid",
    "title" "text" NOT NULL,
    "stage" "text" DEFAULT 'new'::"text" NOT NULL,
    "value" numeric(14,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "expected_close_at" timestamp with time zone,
    "owner_id" "uuid",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "deals_currency_check" CHECK (("char_length"("currency") = 3)),
    CONSTRAINT "deals_stage_check" CHECK (("stage" = ANY (ARRAY['new'::"text", 'qualified'::"text", 'proposal'::"text", 'negotiation'::"text", 'won'::"text", 'lost'::"text"]))),
    CONSTRAINT "deals_title_check" CHECK ((("char_length"(TRIM(BOTH FROM "title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "title")) <= 240))),
    CONSTRAINT "deals_value_check" CHECK (("value" >= (0)::numeric))
);


ALTER TABLE "public"."deals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "bucket_id" "text" DEFAULT 'task-files'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text" NOT NULL,
    "size_bytes" bigint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "uploaded_by" "uuid" NOT NULL,
    CONSTRAINT "files_file_name_check" CHECK (("char_length"(TRIM(BOTH FROM "file_name")) > 0)),
    CONSTRAINT "files_size_bytes_check" CHECK ((("size_bytes" > 0) AND ("size_bytes" <= 6291456)))
);


ALTER TABLE "public"."files" OWNER TO "postgres";


COMMENT ON TABLE "public"."files" IS 'Metadata for Supabase Storage objects attached to tasks.';



CREATE TABLE IF NOT EXISTS "public"."finance_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "type" "public"."finance_transaction_type" NOT NULL,
    "category" "text" NOT NULL,
    "occurred_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "task_id" "uuid",
    CONSTRAINT "finance_transactions_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "finance_transactions_category_check" CHECK (("char_length"(TRIM(BOTH FROM "category")) > 0)),
    CONSTRAINT "finance_transactions_label_check" CHECK (("char_length"(TRIM(BOTH FROM "label")) > 0))
);


ALTER TABLE "public"."finance_transactions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."finance_transactions"."organization_id" IS 'Required tenant boundary column for business entities.';



COMMENT ON COLUMN "public"."finance_transactions"."created_by" IS 'Auth user who created this business entity.';



CREATE TABLE IF NOT EXISTS "public"."graph_node_positions" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "node_type" "text" NOT NULL,
    "node_id" "uuid" NOT NULL,
    "x_position" double precision NOT NULL,
    "y_position" double precision NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."graph_node_positions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."graph_nodes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "project_id" "uuid",
    "status" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "position_x" double precision,
    "position_y" double precision,
    "is_automatic" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "graph_nodes_entity_type_check" CHECK (("entity_type" ~ '^[a-z][a-z0-9_]{1,63}$'::"text")),
    CONSTRAINT "graph_nodes_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
    CONSTRAINT "graph_nodes_title_check" CHECK ((("char_length"(TRIM(BOTH FROM "title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "title")) <= 500)))
);


ALTER TABLE "public"."graph_nodes" OWNER TO "postgres";


COMMENT ON TABLE "public"."graph_nodes" IS 'Universal organization-scoped knowledge graph nodes synchronized from Orbit CRM source entities.';



CREATE TABLE IF NOT EXISTS "public"."graph_relations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "relation_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "source_node_id" "uuid" NOT NULL,
    "target_node_id" "uuid" NOT NULL,
    "direction" "text" DEFAULT 'one_way'::"text" NOT NULL,
    "strength" real DEFAULT 1 NOT NULL,
    "is_automatic" boolean DEFAULT false NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "graph_relations_direction_check" CHECK (("direction" = ANY (ARRAY['one_way'::"text", 'two_way'::"text"]))),
    CONSTRAINT "graph_relations_endpoint_type_check" CHECK ((("source_type" ~ '^[a-z][a-z0-9_]{1,63}$'::"text") AND ("target_type" ~ '^[a-z][a-z0-9_]{1,63}$'::"text"))),
    CONSTRAINT "graph_relations_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
    CONSTRAINT "graph_relations_relation_type_check" CHECK (("relation_type" = ANY (ARRAY['belongs_to'::"text", 'contains'::"text", 'assigned_to'::"text", 'created_by'::"text", 'created_from'::"text", 'generated_from_prompt'::"text", 'uses'::"text", 'used_in'::"text", 'adapted_for'::"text", 'related_to'::"text", 'depends_on'::"text", 'blocks'::"text", 'requires_approval'::"text", 'approved_by'::"text", 'communicates_with'::"text", 'for_client'::"text", 'for_task'::"text"]))),
    CONSTRAINT "graph_relations_strength_check" CHECK ((("strength" > (0)::double precision) AND ("strength" <= (10)::double precision)))
);


ALTER TABLE "public"."graph_relations" OWNER TO "postgres";


COMMENT ON TABLE "public"."graph_relations" IS 'Directed manual and automatic knowledge graph relations. Automatic rows are source-controlled by triggers.';



COMMENT ON COLUMN "public"."graph_relations"."direction" IS 'one_way renders one directed arc; two_way renders two separate opposing arcs.';



CREATE OR REPLACE VIEW "public"."knowledge_edges" WITH ("security_invoker"='true') AS
 SELECT "id",
    "organization_id",
    "source_type",
    "source_id",
    "target_type",
    "target_id",
    "relation_type",
    "created_at",
    "created_by",
    "source_node_id",
    "target_node_id",
    "direction",
    "strength",
    "is_automatic",
    "metadata",
    "updated_at"
   FROM "public"."graph_relations";


ALTER VIEW "public"."knowledge_edges" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."knowledge_nodes" WITH ("security_invoker"='true') AS
 SELECT "organization_id",
    "entity_id" AS "id",
    "entity_type" AS "node_type",
    "title",
    "status",
    "created_at",
    ("metadata" || "jsonb_build_object"('graph_node_id', "id", 'project_id', "project_id", 'position_x', "position_x", 'position_y', "position_y", 'is_automatic', "is_automatic")) AS "metadata"
   FROM "public"."graph_nodes";


ALTER VIEW "public"."knowledge_nodes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "business_name" "text" NOT NULL,
    "category" "text" DEFAULT ''::"text" NOT NULL,
    "city_location" "text" DEFAULT ''::"text" NOT NULL,
    "country" "text" DEFAULT ''::"text" NOT NULL,
    "country_flag" "text" DEFAULT ''::"text" NOT NULL,
    "contact_phone" "text",
    "email" "text" DEFAULT ''::"text" NOT NULL,
    "website_url" "text" DEFAULT ''::"text" NOT NULL,
    "whatsapp_status" "text" DEFAULT ''::"text" NOT NULL,
    "google_maps_url" "text",
    "priority" "public"."lead_client_priority" DEFAULT 'Middle'::"public"."lead_client_priority" NOT NULL,
    "status" "public"."lead_client_status" DEFAULT 'Lead'::"public"."lead_client_status" NOT NULL,
    "website_status_type" "public"."lead_website_status",
    "ai_offer_script" "jsonb",
    "source_query" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "lead_clients_business_name_check" CHECK ((("char_length"(TRIM(BOTH FROM "business_name")) >= 1) AND ("char_length"(TRIM(BOTH FROM "business_name")) <= 240)))
);


ALTER TABLE "public"."lead_clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."openclaw_analyses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "goal_id" "uuid" NOT NULL,
    "analysis_type" "text",
    "content" "text",
    "findings" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."openclaw_analyses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."openclaw_goals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "acceptance_criteria" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "progress" "jsonb" DEFAULT '{"done": 0, "total": 0}'::"jsonb" NOT NULL,
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    CONSTRAINT "openclaw_goals_acceptance_criteria_check" CHECK (("jsonb_typeof"("acceptance_criteria") = 'array'::"text")),
    CONSTRAINT "openclaw_goals_label_check" CHECK ((("char_length"(TRIM(BOTH FROM "label")) >= 1) AND ("char_length"(TRIM(BOTH FROM "label")) <= 240))),
    CONSTRAINT "openclaw_goals_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "openclaw_goals_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'completed'::"text", 'error'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."openclaw_goals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."openclaw_improvements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "goal_id" "uuid" NOT NULL,
    "suggestion" "text" NOT NULL,
    "impact" "text",
    "file_path" "text",
    "code_before" "text",
    "code_after" "text",
    "status" "text" DEFAULT 'pending_review'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "applied_at" timestamp with time zone,
    "rollback_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "openclaw_improvements_status_check" CHECK (("status" = ANY (ARRAY['pending_review'::"text", 'approved'::"text", 'applied'::"text", 'rejected'::"text", 'rolled_back'::"text"])))
);


ALTER TABLE "public"."openclaw_improvements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."openclaw_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "result" "jsonb",
    "error" "text",
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "correlation_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    CONSTRAINT "openclaw_tasks_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'queued'::"text", 'processing'::"text", 'completed'::"text", 'error'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "openclaw_tasks_title_check" CHECK ((("char_length"(TRIM(BOTH FROM "title")) >= 1) AND ("char_length"(TRIM(BOTH FROM "title")) <= 240)))
);


ALTER TABLE "public"."openclaw_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."organization_role" DEFAULT 'member'::"public"."organization_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."organization_members" IS 'Membership and role map for organization-scoped RLS.';



CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    CONSTRAINT "organizations_name_check" CHECK (("char_length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "organizations_slug_check" CHECK (("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::"text"))
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


COMMENT ON TABLE "public"."organizations" IS 'Tenant boundary for Orbit CRM data.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "full_name" "text",
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_links" (
    "organization_id" "uuid" NOT NULL,
    "source_project_id" "uuid" NOT NULL,
    "target_project_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    CONSTRAINT "project_links_check" CHECK (("source_project_id" <> "target_project_id"))
);


ALTER TABLE "public"."project_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "project_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


COMMENT ON TABLE "public"."project_members" IS 'Participants assigned to organization-scoped projects.';



CREATE TABLE IF NOT EXISTS "public"."task_assignees" (
    "task_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."task_assignees" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_assignees" IS 'Additional assignee map for organization-scoped tasks.';



CREATE TABLE IF NOT EXISTS "public"."task_checklist_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "completed_at" timestamp with time zone,
    "completed_by" "uuid",
    "sort_order" numeric(14,4) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    CONSTRAINT "task_checklist_items_sort_order_check" CHECK (("sort_order" >= (0)::numeric)),
    CONSTRAINT "task_checklist_items_title_check" CHECK (("char_length"(TRIM(BOTH FROM "title")) > 0))
);


ALTER TABLE "public"."task_checklist_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_checklist_items" IS 'Checklist items that belong to tasks.';



CREATE TABLE IF NOT EXISTS "public"."task_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "task_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    CONSTRAINT "task_comments_body_check" CHECK (("char_length"(TRIM(BOTH FROM "body")) > 0))
);


ALTER TABLE "public"."task_comments" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_comments" IS 'Persistent task comments.';



CREATE TABLE IF NOT EXISTS "public"."task_label_links" (
    "task_id" "uuid" NOT NULL,
    "label_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."task_label_links" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_label_links" IS 'Many-to-many links between tasks and labels.';



CREATE TABLE IF NOT EXISTS "public"."task_labels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT 'var(--acc-1)'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    CONSTRAINT "task_labels_name_check" CHECK (("char_length"(TRIM(BOTH FROM "name")) > 0))
);


ALTER TABLE "public"."task_labels" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_labels" IS 'Organization-scoped task labels.';



CREATE TABLE IF NOT EXISTS "public"."task_view_preferences" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "selected_view" "text" DEFAULT 'kanban'::"text" NOT NULL,
    "filters" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "list_columns" "text"[] DEFAULT ARRAY['title'::"text", 'project'::"text", 'status'::"text", 'priority'::"text", 'dueDate'::"text", 'assignee'::"text", 'checklist'::"text", 'blocked'::"text"] NOT NULL,
    "sort_key" "text" DEFAULT 'updatedAt'::"text" NOT NULL,
    "sort_direction" "text" DEFAULT 'desc'::"text" NOT NULL,
    "page_size" integer DEFAULT 25 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "task_view_preferences_filters_object_check" CHECK (("jsonb_typeof"("filters") = 'object'::"text")),
    CONSTRAINT "task_view_preferences_page_size_check" CHECK ((("page_size" >= 10) AND ("page_size" <= 100))),
    CONSTRAINT "task_view_preferences_selected_view_check" CHECK (("selected_view" = ANY (ARRAY['kanban'::"text", 'list'::"text"]))),
    CONSTRAINT "task_view_preferences_sort_direction_check" CHECK (("sort_direction" = ANY (ARRAY['asc'::"text", 'desc'::"text"])))
);


ALTER TABLE "public"."task_view_preferences" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_view_preferences" IS 'Per-user task view, filter, column, and sorting preferences.';



CREATE TABLE IF NOT EXISTS "public"."task_watchers" (
    "task_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."task_watchers" OWNER TO "postgres";


COMMENT ON TABLE "public"."task_watchers" IS 'Users subscribed to task updates.';



ALTER TABLE ONLY "private"."openclaw_webhook_events"
    ADD CONSTRAINT "openclaw_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "private"."openclaw_webhook_events"
    ADD CONSTRAINT "openclaw_webhook_events_task_id_idempotency_key_key" UNIQUE ("task_id", "idempotency_key");



ALTER TABLE ONLY "public"."ai_action_audit"
    ADD CONSTRAINT "ai_action_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_improvement_proposal_events"
    ADD CONSTRAINT "ai_improvement_proposal_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_improvement_proposals"
    ADD CONSTRAINT "ai_improvement_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_outcomes"
    ADD CONSTRAINT "ai_outcomes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_user_memory"
    ADD CONSTRAINT "ai_user_memory_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_user_memory_revisions"
    ADD CONSTRAINT "ai_user_memory_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_user_memory"
    ADD CONSTRAINT "ai_user_memory_user_id_organization_id_entity_type_key_phra_key" UNIQUE ("user_id", "organization_id", "entity_type", "key_phrase");



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_reminder_deliveries"
    ADD CONSTRAINT "calendar_reminder_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."calendar_reminder_deliveries"
    ADD CONSTRAINT "calendar_reminder_deliveries_reminder_id_attempt_number_key" UNIQUE ("reminder_id", "attempt_number");



ALTER TABLE ONLY "public"."calendar_reminders"
    ADD CONSTRAINT "calendar_reminders_event_id_channel_key" UNIQUE ("event_id", "channel");



ALTER TABLE ONLY "public"."calendar_reminders"
    ADD CONSTRAINT "calendar_reminders_organization_id_id_key" UNIQUE ("organization_id", "id");



ALTER TABLE ONLY "public"."calendar_reminders"
    ADD CONSTRAINT "calendar_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_interactions"
    ADD CONSTRAINT "client_interactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."communication_events"
    ADD CONSTRAINT "communication_events_organization_id_channel_idempotency_ke_key" UNIQUE ("organization_id", "channel", "idempotency_key");



ALTER TABLE ONLY "public"."communication_events"
    ADD CONSTRAINT "communication_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_knowledge"
    ADD CONSTRAINT "company_knowledge_organization_id_id_key" UNIQUE ("organization_id", "id");



ALTER TABLE ONLY "public"."company_knowledge"
    ADD CONSTRAINT "company_knowledge_organization_id_slug_key" UNIQUE ("organization_id", "slug");



ALTER TABLE ONLY "public"."company_knowledge"
    ADD CONSTRAINT "company_knowledge_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_knowledge_versions"
    ADD CONSTRAINT "company_knowledge_versions_knowledge_id_version_key" UNIQUE ("knowledge_id", "version");



ALTER TABLE ONLY "public"."company_knowledge_versions"
    ADD CONSTRAINT "company_knowledge_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_storage_path_key" UNIQUE ("storage_path");



ALTER TABLE ONLY "public"."finance_transactions"
    ADD CONSTRAINT "finance_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."graph_node_positions"
    ADD CONSTRAINT "graph_node_positions_pkey" PRIMARY KEY ("organization_id", "user_id", "node_type", "node_id");



ALTER TABLE ONLY "public"."graph_nodes"
    ADD CONSTRAINT "graph_nodes_organization_id_entity_type_entity_id_key" UNIQUE ("organization_id", "entity_type", "entity_id");



ALTER TABLE ONLY "public"."graph_nodes"
    ADD CONSTRAINT "graph_nodes_organization_id_id_key" UNIQUE ("organization_id", "id");



ALTER TABLE ONLY "public"."graph_nodes"
    ADD CONSTRAINT "graph_nodes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."graph_relations"
    ADD CONSTRAINT "graph_relations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."graph_relations"
    ADD CONSTRAINT "graph_relations_unique_node_edge" UNIQUE ("organization_id", "source_node_id", "target_node_id", "relation_type", "direction");



ALTER TABLE ONLY "public"."lead_clients"
    ADD CONSTRAINT "lead_clients_organization_id_id_key" UNIQUE ("organization_id", "id");



ALTER TABLE ONLY "public"."lead_clients"
    ADD CONSTRAINT "lead_clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."openclaw_analyses"
    ADD CONSTRAINT "openclaw_analyses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."openclaw_goals"
    ADD CONSTRAINT "openclaw_goals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."openclaw_improvements"
    ADD CONSTRAINT "openclaw_improvements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."openclaw_tasks"
    ADD CONSTRAINT "openclaw_tasks_organization_id_idempotency_key_key" UNIQUE ("organization_id", "idempotency_key");



ALTER TABLE ONLY "public"."openclaw_tasks"
    ADD CONSTRAINT "openclaw_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id", "user_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_links"
    ADD CONSTRAINT "project_links_pkey" PRIMARY KEY ("source_project_id", "target_project_id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id", "user_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_organization_id_id_key" UNIQUE ("organization_id", "id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id", "user_id");



ALTER TABLE ONLY "public"."task_checklist_items"
    ADD CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_label_links"
    ADD CONSTRAINT "task_label_links_pkey" PRIMARY KEY ("task_id", "label_id");



ALTER TABLE ONLY "public"."task_labels"
    ADD CONSTRAINT "task_labels_organization_id_id_key" UNIQUE ("organization_id", "id");



ALTER TABLE ONLY "public"."task_labels"
    ADD CONSTRAINT "task_labels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_view_preferences"
    ADD CONSTRAINT "task_view_preferences_pkey" PRIMARY KEY ("organization_id", "user_id");



ALTER TABLE ONLY "public"."task_watchers"
    ADD CONSTRAINT "task_watchers_pkey" PRIMARY KEY ("task_id", "user_id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_organization_id_id_key" UNIQUE ("organization_id", "id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



CREATE INDEX "openclaw_webhook_events_org_received_idx" ON "private"."openclaw_webhook_events" USING "btree" ("organization_id", "received_at" DESC);



CREATE INDEX "ai_action_audit_correlation_idx" ON "public"."ai_action_audit" USING "btree" ("organization_id", "correlation_id", "created_at" DESC);



CREATE INDEX "ai_action_audit_org_created_idx" ON "public"."ai_action_audit" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "ai_action_audit_user_id_idx" ON "public"."ai_action_audit" USING "btree" ("user_id");



CREATE INDEX "ai_improvement_proposal_events_actor_idx" ON "public"."ai_improvement_proposal_events" USING "btree" ("actor_id") WHERE ("actor_id" IS NOT NULL);



CREATE INDEX "ai_improvement_proposal_events_org_idx" ON "public"."ai_improvement_proposal_events" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "ai_improvement_proposal_events_proposal_idx" ON "public"."ai_improvement_proposal_events" USING "btree" ("proposal_id", "created_at" DESC);



CREATE INDEX "ai_improvement_proposals_created_by_idx" ON "public"."ai_improvement_proposals" USING "btree" ("created_by");



CREATE INDEX "ai_improvement_proposals_knowledge_id_idx" ON "public"."ai_improvement_proposals" USING "btree" ("knowledge_id") WHERE ("knowledge_id" IS NOT NULL);



CREATE INDEX "ai_improvement_proposals_org_status_idx" ON "public"."ai_improvement_proposals" USING "btree" ("organization_id", "status", "created_at" DESC);



CREATE INDEX "ai_improvement_proposals_reviewed_by_idx" ON "public"."ai_improvement_proposals" USING "btree" ("reviewed_by");



CREATE INDEX "ai_improvement_proposals_supersedes_idx" ON "public"."ai_improvement_proposals" USING "btree" ("supersedes_proposal_id") WHERE ("supersedes_proposal_id" IS NOT NULL);



CREATE INDEX "ai_outcomes_interaction_id_idx" ON "public"."ai_outcomes" USING "btree" ("interaction_id") WHERE ("interaction_id" IS NOT NULL);



CREATE INDEX "ai_outcomes_org_client_idx" ON "public"."ai_outcomes" USING "btree" ("organization_id", "client_id", "created_at" DESC);



CREATE INDEX "ai_outcomes_recorded_by_idx" ON "public"."ai_outcomes" USING "btree" ("recorded_by");



CREATE INDEX "ai_user_memory_active_idx" ON "public"."ai_user_memory" USING "btree" ("organization_id", "user_id", "updated_at" DESC) WHERE ("expires_at" IS NULL);



CREATE INDEX "ai_user_memory_corrected_by_idx" ON "public"."ai_user_memory" USING "btree" ("corrected_by") WHERE ("corrected_by" IS NOT NULL);



CREATE INDEX "ai_user_memory_expires_idx" ON "public"."ai_user_memory" USING "btree" ("expires_at") WHERE ("expires_at" IS NOT NULL);



CREATE INDEX "ai_user_memory_revisions_changed_by_idx" ON "public"."ai_user_memory_revisions" USING "btree" ("changed_by") WHERE ("changed_by" IS NOT NULL);



CREATE INDEX "ai_user_memory_revisions_memory_id_idx" ON "public"."ai_user_memory_revisions" USING "btree" ("memory_id");



CREATE INDEX "ai_user_memory_revisions_owner_idx" ON "public"."ai_user_memory_revisions" USING "btree" ("organization_id", "user_id", "memory_id", "replaced_at" DESC);



CREATE INDEX "ai_user_memory_revisions_user_id_idx" ON "public"."ai_user_memory_revisions" USING "btree" ("user_id");



CREATE INDEX "ai_user_memory_scope_idx" ON "public"."ai_user_memory" USING "btree" ("organization_id", "user_id", "entity_type");



CREATE INDEX "calendar_events_client_fk_idx" ON "public"."calendar_events" USING "btree" ("organization_id", "client_id");



CREATE INDEX "calendar_events_created_by_idx" ON "public"."calendar_events" USING "btree" ("created_by");



CREATE INDEX "calendar_events_deal_id_idx" ON "public"."calendar_events" USING "btree" ("deal_id");



CREATE INDEX "calendar_events_org_time_idx" ON "public"."calendar_events" USING "btree" ("organization_id", "starts_at");



CREATE INDEX "calendar_events_reminder_idx" ON "public"."calendar_events" USING "btree" ("reminder_at") WHERE (("reminder_at" IS NOT NULL) AND ("reminder_sent_at" IS NULL));



CREATE INDEX "calendar_events_task_fk_idx" ON "public"."calendar_events" USING "btree" ("organization_id", "task_id");



CREATE INDEX "calendar_reminder_deliveries_event_idx" ON "public"."calendar_reminder_deliveries" USING "btree" ("event_id");



CREATE INDEX "calendar_reminder_deliveries_org_created_idx" ON "public"."calendar_reminder_deliveries" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "calendar_reminders_due_idx" ON "public"."calendar_reminders" USING "btree" ("scheduled_for", "id") WHERE ("status" = 'queued'::"text");



CREATE INDEX "calendar_reminders_org_event_idx" ON "public"."calendar_reminders" USING "btree" ("organization_id", "event_id");



CREATE INDEX "client_interactions_created_by_idx" ON "public"."client_interactions" USING "btree" ("created_by");



CREATE INDEX "client_interactions_deal_id_idx" ON "public"."client_interactions" USING "btree" ("deal_id");



CREATE INDEX "client_interactions_timeline_idx" ON "public"."client_interactions" USING "btree" ("organization_id", "client_id", "occurred_at" DESC);



CREATE INDEX "communication_events_org_created_idx" ON "public"."communication_events" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "communication_events_provider_message_idx" ON "public"."communication_events" USING "btree" ("provider_message_id") WHERE ("provider_message_id" IS NOT NULL);



CREATE INDEX "communication_events_user_idx" ON "public"."communication_events" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "company_knowledge_org_category_idx" ON "public"."company_knowledge" USING "btree" ("organization_id", "category");



CREATE INDEX "company_knowledge_versions_parent_idx" ON "public"."company_knowledge_versions" USING "btree" ("organization_id", "knowledge_id", "version" DESC);



CREATE INDEX "deals_client_fk_idx" ON "public"."deals" USING "btree" ("organization_id", "client_id");



CREATE INDEX "deals_created_by_idx" ON "public"."deals" USING "btree" ("created_by");



CREATE INDEX "deals_org_stage_idx" ON "public"."deals" USING "btree" ("organization_id", "stage");



CREATE INDEX "deals_owner_id_idx" ON "public"."deals" USING "btree" ("owner_id");



CREATE INDEX "deals_project_fk_idx" ON "public"."deals" USING "btree" ("organization_id", "project_id");



CREATE INDEX "files_task_created_idx" ON "public"."files" USING "btree" ("organization_id", "task_id", "created_at" DESC);



CREATE INDEX "files_uploaded_by_idx" ON "public"."files" USING "btree" ("uploaded_by");



CREATE INDEX "finance_transactions_created_by_idx" ON "public"."finance_transactions" USING "btree" ("created_by");



CREATE INDEX "finance_transactions_organization_date_idx" ON "public"."finance_transactions" USING "btree" ("organization_id", "occurred_on" DESC);



CREATE INDEX "finance_transactions_task_id_idx" ON "public"."finance_transactions" USING "btree" ("task_id") WHERE ("task_id" IS NOT NULL);



CREATE INDEX "graph_node_positions_user_lookup_idx" ON "public"."graph_node_positions" USING "btree" ("user_id", "organization_id");



CREATE INDEX "graph_nodes_created_by_idx" ON "public"."graph_nodes" USING "btree" ("created_by") WHERE ("created_by" IS NOT NULL);



CREATE INDEX "graph_nodes_project_lookup_idx" ON "public"."graph_nodes" USING "btree" ("organization_id", "project_id", "entity_type", "updated_at" DESC) WHERE ("project_id" IS NOT NULL);



CREATE INDEX "graph_nodes_title_search_idx" ON "public"."graph_nodes" USING "btree" ("organization_id", "lower"("title") "text_pattern_ops");



CREATE INDEX "graph_nodes_type_lookup_idx" ON "public"."graph_nodes" USING "btree" ("organization_id", "entity_type", "updated_at" DESC);



CREATE INDEX "graph_relations_created_by_v2_idx" ON "public"."graph_relations" USING "btree" ("created_by") WHERE ("created_by" IS NOT NULL);



CREATE INDEX "graph_relations_manual_idx" ON "public"."graph_relations" USING "btree" ("organization_id", "created_by", "updated_at" DESC) WHERE (NOT "is_automatic");



CREATE INDEX "graph_relations_source_node_idx" ON "public"."graph_relations" USING "btree" ("organization_id", "source_node_id", "updated_at" DESC);



CREATE INDEX "graph_relations_target_node_idx" ON "public"."graph_relations" USING "btree" ("organization_id", "target_node_id", "updated_at" DESC);



CREATE INDEX "lead_clients_org_city_idx" ON "public"."lead_clients" USING "btree" ("organization_id", "city_location");



CREATE INDEX "lead_clients_org_status_idx" ON "public"."lead_clients" USING "btree" ("organization_id", "status");



CREATE INDEX "lead_clients_user_id_idx" ON "public"."lead_clients" USING "btree" ("user_id");



CREATE INDEX "openclaw_analyses_goal_id_idx" ON "public"."openclaw_analyses" USING "btree" ("goal_id");



CREATE INDEX "openclaw_goals_created_by_idx" ON "public"."openclaw_goals" USING "btree" ("created_by");



CREATE INDEX "openclaw_goals_org_status_idx" ON "public"."openclaw_goals" USING "btree" ("organization_id", "status");



CREATE INDEX "openclaw_improvements_approved_by_idx" ON "public"."openclaw_improvements" USING "btree" ("approved_by");



CREATE INDEX "openclaw_improvements_goal_status_idx" ON "public"."openclaw_improvements" USING "btree" ("goal_id", "status");



CREATE INDEX "openclaw_tasks_created_by_idx" ON "public"."openclaw_tasks" USING "btree" ("created_by");



CREATE UNIQUE INDEX "openclaw_tasks_org_correlation_uidx" ON "public"."openclaw_tasks" USING "btree" ("organization_id", "correlation_id");



CREATE INDEX "openclaw_tasks_org_created_idx" ON "public"."openclaw_tasks" USING "btree" ("organization_id", "created_at" DESC);



CREATE INDEX "organization_members_created_by_idx" ON "public"."organization_members" USING "btree" ("created_by");



CREATE INDEX "organization_members_role_idx" ON "public"."organization_members" USING "btree" ("organization_id", "role");



CREATE INDEX "organization_members_user_id_idx" ON "public"."organization_members" USING "btree" ("user_id");



CREATE INDEX "organizations_created_by_idx" ON "public"."organizations" USING "btree" ("created_by");



CREATE INDEX "project_links_created_by_idx" ON "public"."project_links" USING "btree" ("created_by");



CREATE INDEX "project_links_organization_id_idx" ON "public"."project_links" USING "btree" ("organization_id");



CREATE INDEX "project_links_target_project_id_idx" ON "public"."project_links" USING "btree" ("target_project_id");



CREATE INDEX "project_members_created_by_idx" ON "public"."project_members" USING "btree" ("created_by");



CREATE INDEX "project_members_organization_project_idx" ON "public"."project_members" USING "btree" ("organization_id", "project_id");



CREATE INDEX "project_members_organization_user_idx" ON "public"."project_members" USING "btree" ("organization_id", "user_id");



CREATE INDEX "projects_created_by_idx" ON "public"."projects" USING "btree" ("created_by");



CREATE INDEX "projects_organization_active_idx" ON "public"."projects" USING "btree" ("organization_id", "status", "priority", "created_at" DESC) WHERE ("archived_at" IS NULL);



CREATE INDEX "projects_organization_archived_idx" ON "public"."projects" USING "btree" ("organization_id", "archived_at" DESC) WHERE ("archived_at" IS NOT NULL);



CREATE INDEX "projects_organization_id_idx" ON "public"."projects" USING "btree" ("organization_id");



CREATE INDEX "projects_owner_id_idx" ON "public"."projects" USING "btree" ("owner_id");



CREATE INDEX "task_assignees_created_by_idx" ON "public"."task_assignees" USING "btree" ("created_by");



CREATE INDEX "task_assignees_organization_user_idx" ON "public"."task_assignees" USING "btree" ("organization_id", "user_id");



CREATE INDEX "task_checklist_items_created_by_idx" ON "public"."task_checklist_items" USING "btree" ("created_by");



CREATE INDEX "task_checklist_items_task_sort_idx" ON "public"."task_checklist_items" USING "btree" ("organization_id", "task_id", "sort_order", "created_at");



CREATE INDEX "task_comments_created_by_idx" ON "public"."task_comments" USING "btree" ("created_by");



CREATE INDEX "task_comments_task_created_idx" ON "public"."task_comments" USING "btree" ("organization_id", "task_id", "created_at");



CREATE INDEX "task_label_links_created_by_idx" ON "public"."task_label_links" USING "btree" ("created_by");



CREATE INDEX "task_label_links_organization_label_idx" ON "public"."task_label_links" USING "btree" ("organization_id", "label_id");



CREATE UNIQUE INDEX "task_labels_organization_lower_name_key" ON "public"."task_labels" USING "btree" ("organization_id", "lower"("name"));



CREATE INDEX "task_watchers_created_by_idx" ON "public"."task_watchers" USING "btree" ("created_by");



CREATE INDEX "task_watchers_organization_user_idx" ON "public"."task_watchers" USING "btree" ("organization_id", "user_id");



CREATE INDEX "tasks_assignee_id_idx" ON "public"."tasks" USING "btree" ("assignee_id");



CREATE INDEX "tasks_author_id_idx" ON "public"."tasks" USING "btree" ("author_id");



CREATE INDEX "tasks_created_by_idx" ON "public"."tasks" USING "btree" ("created_by");



CREATE INDEX "tasks_organization_active_idx" ON "public"."tasks" USING "btree" ("organization_id", "status", "priority", "sort_order", "created_at" DESC) WHERE ("archived_at" IS NULL);



CREATE INDEX "tasks_organization_archived_idx" ON "public"."tasks" USING "btree" ("organization_id", "archived_at" DESC) WHERE ("archived_at" IS NOT NULL);



CREATE INDEX "tasks_organization_assignee_idx" ON "public"."tasks" USING "btree" ("organization_id", "assignee_id") WHERE ("archived_at" IS NULL);



CREATE INDEX "tasks_organization_due_open_idx" ON "public"."tasks" USING "btree" ("organization_id", "due_date") WHERE (("archived_at" IS NULL) AND ("status" <> ALL (ARRAY['completed'::"text", 'cancelled'::"text"])));



CREATE INDEX "tasks_organization_priority_idx" ON "public"."tasks" USING "btree" ("organization_id", "priority") WHERE ("archived_at" IS NULL);



CREATE INDEX "tasks_organization_project_status_idx" ON "public"."tasks" USING "btree" ("organization_id", "project_id", "status") WHERE ("archived_at" IS NULL);



CREATE INDEX "tasks_organization_status_idx" ON "public"."tasks" USING "btree" ("organization_id", "status");



CREATE INDEX "tasks_organization_status_sort_order_idx" ON "public"."tasks" USING "btree" ("organization_id", "status", "sort_order", "id") WHERE ("archived_at" IS NULL);



CREATE INDEX "tasks_parent_task_id_idx" ON "public"."tasks" USING "btree" ("parent_task_id");



CREATE INDEX "tasks_project_id_idx" ON "public"."tasks" USING "btree" ("project_id");



CREATE INDEX "tasks_tags_idx" ON "public"."tasks" USING "gin" ("tags");



CREATE OR REPLACE TRIGGER "archive_ai_user_memory_revision" BEFORE UPDATE ON "public"."ai_user_memory" FOR EACH ROW EXECUTE FUNCTION "private"."archive_ai_user_memory_revision"();



CREATE OR REPLACE TRIGGER "audit_improvement_proposal_status" AFTER INSERT OR UPDATE OF "status" ON "public"."ai_improvement_proposals" FOR EACH ROW EXECUTE FUNCTION "private"."audit_improvement_proposal_status"();



CREATE OR REPLACE TRIGGER "normalize_graph_relation" BEFORE INSERT OR UPDATE ON "public"."graph_relations" FOR EACH ROW EXECUTE FUNCTION "private"."normalize_graph_relation"();



CREATE OR REPLACE TRIGGER "prepare_calendar_event_reminder" BEFORE INSERT OR UPDATE OF "reminder_at", "status", "starts_at" ON "public"."calendar_events" FOR EACH ROW EXECUTE FUNCTION "public"."prepare_calendar_event_reminder"();



CREATE OR REPLACE TRIGGER "set_ai_user_memory_updated_at" BEFORE UPDATE ON "public"."ai_user_memory" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_calendar_events_updated_at" BEFORE UPDATE ON "public"."calendar_events" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_deals_updated_at" BEFORE UPDATE ON "public"."deals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_finance_transactions_updated_at" BEFORE UPDATE ON "public"."finance_transactions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_graph_node_positions_updated_at" BEFORE UPDATE ON "public"."graph_node_positions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_graph_nodes_updated_at" BEFORE UPDATE ON "public"."graph_nodes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_graph_relations_updated_at" BEFORE UPDATE ON "public"."graph_relations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_lead_clients_updated_at" BEFORE UPDATE ON "public"."lead_clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_openclaw_goals_updated_at" BEFORE UPDATE ON "public"."openclaw_goals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_openclaw_tasks_updated_at" BEFORE UPDATE ON "public"."openclaw_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_organization_members_updated_at" BEFORE UPDATE ON "public"."organization_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_organizations_updated_at" BEFORE UPDATE ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_project_links_updated_at" BEFORE UPDATE ON "public"."project_links" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_project_members_updated_at" BEFORE UPDATE ON "public"."project_members" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_projects_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_task_checklist_items_updated_at" BEFORE UPDATE ON "public"."task_checklist_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_task_comments_updated_at" BEFORE UPDATE ON "public"."task_comments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_task_labels_updated_at" BEFORE UPDATE ON "public"."task_labels" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_task_view_preferences_updated_at" BEFORE UPDATE ON "public"."task_view_preferences" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_tasks_status_timestamps" BEFORE INSERT OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_task_status_timestamps"();



CREATE OR REPLACE TRIGGER "set_tasks_updated_at" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "sync_calendar_event_reminder" AFTER INSERT OR UPDATE OF "reminder_at", "status", "starts_at" ON "public"."calendar_events" FOR EACH ROW EXECUTE FUNCTION "public"."sync_calendar_event_reminder"();



CREATE OR REPLACE TRIGGER "sync_calendar_events_memory_graph" AFTER INSERT OR DELETE OR UPDATE ON "public"."calendar_events" FOR EACH ROW EXECUTE FUNCTION "private"."sync_crm_memory_graph"('calendar_event');



CREATE OR REPLACE TRIGGER "sync_graph_checklist_item" AFTER INSERT OR DELETE OR UPDATE ON "public"."task_checklist_items" FOR EACH ROW EXECUTE FUNCTION "private"."sync_graph_checklist_item"();



CREATE OR REPLACE TRIGGER "sync_graph_file" AFTER INSERT OR DELETE OR UPDATE ON "public"."files" FOR EACH ROW EXECUTE FUNCTION "private"."sync_graph_file"();



CREATE OR REPLACE TRIGGER "sync_graph_finance" AFTER INSERT OR DELETE OR UPDATE ON "public"."finance_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."sync_graph_finance"();



CREATE OR REPLACE TRIGGER "sync_graph_organization_member" AFTER INSERT OR DELETE OR UPDATE ON "public"."organization_members" FOR EACH ROW EXECUTE FUNCTION "private"."sync_graph_organization_member"();



CREATE OR REPLACE TRIGGER "sync_graph_project" AFTER INSERT OR DELETE OR UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "private"."sync_graph_project"();



CREATE OR REPLACE TRIGGER "sync_graph_project_link" AFTER INSERT OR DELETE OR UPDATE ON "public"."project_links" FOR EACH ROW EXECUTE FUNCTION "private"."sync_graph_project_link"();



CREATE OR REPLACE TRIGGER "sync_graph_project_member" AFTER INSERT OR DELETE ON "public"."project_members" FOR EACH ROW EXECUTE FUNCTION "private"."sync_graph_project_member"();



CREATE OR REPLACE TRIGGER "sync_graph_task" AFTER INSERT OR DELETE OR UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "private"."sync_graph_task"();



CREATE OR REPLACE TRIGGER "sync_graph_task_assignee" AFTER INSERT OR DELETE ON "public"."task_assignees" FOR EACH ROW EXECUTE FUNCTION "private"."sync_graph_task_assignee"();



CREATE OR REPLACE TRIGGER "sync_graph_task_comment" AFTER INSERT OR DELETE OR UPDATE ON "public"."task_comments" FOR EACH ROW EXECUTE FUNCTION "private"."sync_graph_task_comment"();



CREATE OR REPLACE TRIGGER "sync_lead_clients_memory_graph" AFTER INSERT OR DELETE OR UPDATE ON "public"."lead_clients" FOR EACH ROW EXECUTE FUNCTION "private"."sync_crm_memory_graph"('client');



ALTER TABLE ONLY "private"."openclaw_webhook_events"
    ADD CONSTRAINT "openclaw_webhook_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."openclaw_webhook_events"
    ADD CONSTRAINT "openclaw_webhook_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."openclaw_tasks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_action_audit"
    ADD CONSTRAINT "ai_action_audit_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_action_audit"
    ADD CONSTRAINT "ai_action_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_improvement_proposal_events"
    ADD CONSTRAINT "ai_improvement_proposal_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_improvement_proposal_events"
    ADD CONSTRAINT "ai_improvement_proposal_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_improvement_proposal_events"
    ADD CONSTRAINT "ai_improvement_proposal_events_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "public"."ai_improvement_proposals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_improvement_proposals"
    ADD CONSTRAINT "ai_improvement_proposals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_improvement_proposals"
    ADD CONSTRAINT "ai_improvement_proposals_knowledge_id_fkey" FOREIGN KEY ("knowledge_id") REFERENCES "public"."company_knowledge"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_improvement_proposals"
    ADD CONSTRAINT "ai_improvement_proposals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_improvement_proposals"
    ADD CONSTRAINT "ai_improvement_proposals_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_improvement_proposals"
    ADD CONSTRAINT "ai_improvement_proposals_supersedes_proposal_id_fkey" FOREIGN KEY ("supersedes_proposal_id") REFERENCES "public"."ai_improvement_proposals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_outcomes"
    ADD CONSTRAINT "ai_outcomes_client_fk" FOREIGN KEY ("organization_id", "client_id") REFERENCES "public"."lead_clients"("organization_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_outcomes"
    ADD CONSTRAINT "ai_outcomes_interaction_id_fkey" FOREIGN KEY ("interaction_id") REFERENCES "public"."client_interactions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_outcomes"
    ADD CONSTRAINT "ai_outcomes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_outcomes"
    ADD CONSTRAINT "ai_outcomes_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."ai_user_memory"
    ADD CONSTRAINT "ai_user_memory_corrected_by_fkey" FOREIGN KEY ("corrected_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_user_memory"
    ADD CONSTRAINT "ai_user_memory_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_user_memory_revisions"
    ADD CONSTRAINT "ai_user_memory_revisions_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_user_memory_revisions"
    ADD CONSTRAINT "ai_user_memory_revisions_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "public"."ai_user_memory"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_user_memory_revisions"
    ADD CONSTRAINT "ai_user_memory_revisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_user_memory_revisions"
    ADD CONSTRAINT "ai_user_memory_revisions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_user_memory"
    ADD CONSTRAINT "ai_user_memory_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_client_fk" FOREIGN KEY ("organization_id", "client_id") REFERENCES "public"."lead_clients"("organization_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_events"
    ADD CONSTRAINT "calendar_events_task_fk" FOREIGN KEY ("organization_id", "task_id") REFERENCES "public"."tasks"("organization_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."calendar_reminder_deliveries"
    ADD CONSTRAINT "calendar_reminder_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_reminder_deliveries"
    ADD CONSTRAINT "calendar_reminder_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_reminder_deliveries"
    ADD CONSTRAINT "calendar_reminder_deliveries_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "public"."calendar_reminders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_reminders"
    ADD CONSTRAINT "calendar_reminders_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."calendar_reminders"
    ADD CONSTRAINT "calendar_reminders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_interactions"
    ADD CONSTRAINT "client_interactions_client_fk" FOREIGN KEY ("organization_id", "client_id") REFERENCES "public"."lead_clients"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_interactions"
    ADD CONSTRAINT "client_interactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."client_interactions"
    ADD CONSTRAINT "client_interactions_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."client_interactions"
    ADD CONSTRAINT "client_interactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."communication_events"
    ADD CONSTRAINT "communication_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."communication_events"
    ADD CONSTRAINT "communication_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_knowledge"
    ADD CONSTRAINT "company_knowledge_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."company_knowledge"
    ADD CONSTRAINT "company_knowledge_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_knowledge_versions"
    ADD CONSTRAINT "company_knowledge_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."company_knowledge_versions"
    ADD CONSTRAINT "company_knowledge_versions_parent_fk" FOREIGN KEY ("organization_id", "knowledge_id") REFERENCES "public"."company_knowledge"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_client_fk" FOREIGN KEY ("organization_id", "client_id") REFERENCES "public"."lead_clients"("organization_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."deals"
    ADD CONSTRAINT "deals_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "public"."projects"("organization_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_organization_id_task_id_fkey" FOREIGN KEY ("organization_id", "task_id") REFERENCES "public"."tasks"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."files"
    ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."finance_transactions"
    ADD CONSTRAINT "finance_transactions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."finance_transactions"
    ADD CONSTRAINT "finance_transactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."finance_transactions"
    ADD CONSTRAINT "finance_transactions_task_same_organization_fkey" FOREIGN KEY ("organization_id", "task_id") REFERENCES "public"."tasks"("organization_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."graph_node_positions"
    ADD CONSTRAINT "graph_node_positions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."graph_node_positions"
    ADD CONSTRAINT "graph_node_positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."graph_nodes"
    ADD CONSTRAINT "graph_nodes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."graph_nodes"
    ADD CONSTRAINT "graph_nodes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."graph_nodes"
    ADD CONSTRAINT "graph_nodes_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "public"."projects"("organization_id", "id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."graph_relations"
    ADD CONSTRAINT "graph_relations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."graph_relations"
    ADD CONSTRAINT "graph_relations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."graph_relations"
    ADD CONSTRAINT "graph_relations_source_node_fkey" FOREIGN KEY ("organization_id", "source_node_id") REFERENCES "public"."graph_nodes"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."graph_relations"
    ADD CONSTRAINT "graph_relations_target_node_fkey" FOREIGN KEY ("organization_id", "target_node_id") REFERENCES "public"."graph_nodes"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_clients"
    ADD CONSTRAINT "lead_clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_clients"
    ADD CONSTRAINT "lead_clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."openclaw_analyses"
    ADD CONSTRAINT "openclaw_analyses_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "public"."openclaw_goals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."openclaw_goals"
    ADD CONSTRAINT "openclaw_goals_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."openclaw_goals"
    ADD CONSTRAINT "openclaw_goals_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."openclaw_improvements"
    ADD CONSTRAINT "openclaw_improvements_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."openclaw_improvements"
    ADD CONSTRAINT "openclaw_improvements_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "public"."openclaw_goals"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."openclaw_tasks"
    ADD CONSTRAINT "openclaw_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."openclaw_tasks"
    ADD CONSTRAINT "openclaw_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_links"
    ADD CONSTRAINT "project_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_links"
    ADD CONSTRAINT "project_links_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_links"
    ADD CONSTRAINT "project_links_source_project_id_fkey" FOREIGN KEY ("source_project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_links"
    ADD CONSTRAINT "project_links_target_project_id_fkey" FOREIGN KEY ("target_project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_organization_id_project_id_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "public"."projects"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "public"."organization_members"("organization_id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_organization_id_task_id_fkey" FOREIGN KEY ("organization_id", "task_id") REFERENCES "public"."tasks"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_assignees"
    ADD CONSTRAINT "task_assignees_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "public"."organization_members"("organization_id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_checklist_items"
    ADD CONSTRAINT "task_checklist_items_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."task_checklist_items"
    ADD CONSTRAINT "task_checklist_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."task_checklist_items"
    ADD CONSTRAINT "task_checklist_items_organization_id_task_id_fkey" FOREIGN KEY ("organization_id", "task_id") REFERENCES "public"."tasks"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."task_comments"
    ADD CONSTRAINT "task_comments_organization_id_task_id_fkey" FOREIGN KEY ("organization_id", "task_id") REFERENCES "public"."tasks"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_label_links"
    ADD CONSTRAINT "task_label_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."task_label_links"
    ADD CONSTRAINT "task_label_links_organization_id_label_id_fkey" FOREIGN KEY ("organization_id", "label_id") REFERENCES "public"."task_labels"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_label_links"
    ADD CONSTRAINT "task_label_links_organization_id_task_id_fkey" FOREIGN KEY ("organization_id", "task_id") REFERENCES "public"."tasks"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_labels"
    ADD CONSTRAINT "task_labels_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."task_labels"
    ADD CONSTRAINT "task_labels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_view_preferences"
    ADD CONSTRAINT "task_view_preferences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_view_preferences"
    ADD CONSTRAINT "task_view_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_watchers"
    ADD CONSTRAINT "task_watchers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."task_watchers"
    ADD CONSTRAINT "task_watchers_organization_id_task_id_fkey" FOREIGN KEY ("organization_id", "task_id") REFERENCES "public"."tasks"("organization_id", "id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."task_watchers"
    ADD CONSTRAINT "task_watchers_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "public"."organization_members"("organization_id", "user_id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_assignee_same_organization_fkey" FOREIGN KEY ("organization_id", "assignee_id") REFERENCES "public"."organization_members"("organization_id", "user_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_author_same_organization_fkey" FOREIGN KEY ("organization_id", "author_id") REFERENCES "public"."organization_members"("organization_id", "user_id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_parent_task_same_organization_fkey" FOREIGN KEY ("organization_id", "parent_task_id") REFERENCES "public"."tasks"("organization_id", "id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_project_same_organization_fkey" FOREIGN KEY ("organization_id", "project_id") REFERENCES "public"."projects"("organization_id", "id") ON DELETE RESTRICT;



ALTER TABLE "private"."openclaw_webhook_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "openclaw_webhook_events_service_all" ON "private"."openclaw_webhook_events" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Accountants and managers can create finance transactions" ON "public"."finance_transactions" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role", 'manager'::"public"."organization_role", 'accountant'::"public"."organization_role"]))));



CREATE POLICY "Accountants and managers can update finance transactions" ON "public"."finance_transactions" FOR UPDATE TO "authenticated" USING (("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role", 'manager'::"public"."organization_role", 'accountant'::"public"."organization_role"]))) WITH CHECK (("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role", 'manager'::"public"."organization_role", 'accountant'::"public"."organization_role"])));



CREATE POLICY "Authenticated users can create organizations" ON "public"."organizations" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Authorized users can add organization members" ON "public"."organization_members" FOR INSERT TO "authenticated" WITH CHECK (((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND ("role" = 'owner'::"public"."organization_role") AND (NOT "private"."organization_has_members"("organization_id")) AND (EXISTS ( SELECT 1
   FROM "public"."organizations" "org"
  WHERE (("org"."id" = "organization_members"."organization_id") AND ("org"."created_by" = ( SELECT "auth"."uid"() AS "uid")))))) OR ("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role"]))));



CREATE POLICY "Members can create files" ON "public"."files" FOR INSERT TO "authenticated" WITH CHECK ((("uploaded_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can create manual graph nodes" ON "public"."graph_nodes" FOR INSERT TO "authenticated" WITH CHECK (((NOT "is_automatic") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can create manual graph relations" ON "public"."graph_relations" FOR INSERT TO "authenticated" WITH CHECK (((NOT "is_automatic") AND ("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can create project links" ON "public"."project_links" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can create projects" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")) AND (("owner_id" IS NULL) OR "private"."is_organization_member"("organization_id", "owner_id"))));



CREATE POLICY "Members can create task assignees" ON "public"."task_assignees" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", "user_id")));



CREATE POLICY "Members can create task checklist items" ON "public"."task_checklist_items" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can create task comments" ON "public"."task_comments" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can create task label links" ON "public"."task_label_links" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can create task labels" ON "public"."task_labels" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can create task watchers" ON "public"."task_watchers" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", "user_id")));



CREATE POLICY "Members can create tasks" ON "public"."tasks" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can delete files" ON "public"."files" FOR DELETE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can delete manual graph nodes" ON "public"."graph_nodes" FOR DELETE TO "authenticated" USING (((NOT "is_automatic") AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")) AND (("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role", 'manager'::"public"."organization_role"])))));



CREATE POLICY "Members can delete manual graph relations" ON "public"."graph_relations" FOR DELETE TO "authenticated" USING (((NOT "is_automatic") AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")) AND (("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role", 'manager'::"public"."organization_role"])))));



CREATE POLICY "Members can delete project links" ON "public"."project_links" FOR DELETE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can delete task assignees" ON "public"."task_assignees" FOR DELETE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can delete task checklist items" ON "public"."task_checklist_items" FOR DELETE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can delete task comments" ON "public"."task_comments" FOR DELETE TO "authenticated" USING ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can delete task label links" ON "public"."task_label_links" FOR DELETE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can delete task labels" ON "public"."task_labels" FOR DELETE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can delete task watchers" ON "public"."task_watchers" FOR DELETE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can delete tasks" ON "public"."tasks" FOR DELETE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read files" ON "public"."files" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read finance transactions" ON "public"."finance_transactions" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read graph nodes" ON "public"."graph_nodes" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read graph relations" ON "public"."graph_relations" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read organization members" ON "public"."organization_members" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read project links" ON "public"."project_links" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read projects" ON "public"."projects" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read task assignees" ON "public"."task_assignees" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read task checklist items" ON "public"."task_checklist_items" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read task comments" ON "public"."task_comments" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read task label links" ON "public"."task_label_links" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read task labels" ON "public"."task_labels" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read task watchers" ON "public"."task_watchers" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read tasks" ON "public"."tasks" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can read their organizations" ON "public"."organizations" FOR SELECT TO "authenticated" USING ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR "private"."is_organization_member"("id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can update manual graph nodes" ON "public"."graph_nodes" FOR UPDATE TO "authenticated" USING (((NOT "is_automatic") AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")) AND (("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role", 'manager'::"public"."organization_role"]))))) WITH CHECK (((NOT "is_automatic") AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can update manual graph relations" ON "public"."graph_relations" FOR UPDATE TO "authenticated" USING (((NOT "is_automatic") AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")) AND (("created_by" = ( SELECT "auth"."uid"() AS "uid")) OR ("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role", 'manager'::"public"."organization_role"]))))) WITH CHECK (((NOT "is_automatic") AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can update project links" ON "public"."project_links" FOR UPDATE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can update task checklist items" ON "public"."task_checklist_items" FOR UPDATE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can update task comments" ON "public"."task_comments" FOR UPDATE TO "authenticated" USING ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Members can update task labels" ON "public"."task_labels" FOR UPDATE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Members can update tasks" ON "public"."tasks" FOR UPDATE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Organization members can read fellow member profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING ("private"."users_share_organization"("id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Organization members can read project members" ON "public"."project_members" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Owners and admins can delete finance transactions" ON "public"."finance_transactions" FOR DELETE TO "authenticated" USING (("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role"])));



CREATE POLICY "Owners and admins can remove members" ON "public"."organization_members" FOR DELETE TO "authenticated" USING (("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role"])));



CREATE POLICY "Owners and admins can update members" ON "public"."organization_members" FOR UPDATE TO "authenticated" USING (("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role"]))) WITH CHECK (("private"."user_organization_role"("organization_id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role"])));



CREATE POLICY "Owners and admins can update organizations" ON "public"."organizations" FOR UPDATE TO "authenticated" USING (("private"."user_organization_role"("id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role"]))) WITH CHECK (("private"."user_organization_role"("id", ( SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role"])));



CREATE POLICY "Owners can delete organizations" ON "public"."organizations" FOR DELETE TO "authenticated" USING (("private"."user_organization_role"("id", ( SELECT "auth"."uid"() AS "uid")) = 'owner'::"public"."organization_role"));



CREATE POLICY "Project managers can add project members" ON "public"."project_members" FOR INSERT TO "authenticated" WITH CHECK (("private"."can_manage_project"("project_id", ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", "user_id")));



CREATE POLICY "Project managers can remove project members" ON "public"."project_members" FOR DELETE TO "authenticated" USING ("private"."can_manage_project"("project_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Project participants can update projects" ON "public"."projects" FOR UPDATE TO "authenticated" USING ("private"."can_manage_project"("id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("private"."can_manage_project"("id", ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")) AND (("owner_id" IS NULL) OR "private"."is_organization_member"("organization_id", "owner_id"))));



CREATE POLICY "Users can create their graph positions" ON "public"."graph_node_positions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can create their task view preferences" ON "public"."task_view_preferences" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can delete their graph positions" ON "public"."graph_node_positions" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can delete their task view preferences" ON "public"."task_view_preferences" FOR DELETE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can insert their own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can read their graph positions" ON "public"."graph_node_positions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can read their own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can read their task view preferences" ON "public"."task_view_preferences" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can update their graph positions" ON "public"."graph_node_positions" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "id"));



CREATE POLICY "Users can update their task view preferences" ON "public"."task_view_preferences" FOR UPDATE TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."ai_action_audit" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_action_audit_member_select" ON "public"."ai_action_audit" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."ai_improvement_proposal_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_improvement_proposal_events_member_select" ON "public"."ai_improvement_proposal_events" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."ai_improvement_proposals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_improvement_proposals_member_select" ON "public"."ai_improvement_proposals" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."ai_outcomes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_outcomes_member_select" ON "public"."ai_outcomes" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."ai_user_memory" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_user_memory_owner_all" ON "public"."ai_user_memory" TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."ai_user_memory_revisions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_user_memory_revisions_owner_read" ON "public"."ai_user_memory_revisions" FOR SELECT TO "authenticated" USING ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."calendar_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calendar_events_member_insert" ON "public"."calendar_events" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "calendar_events_member_select" ON "public"."calendar_events" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "calendar_events_member_update" ON "public"."calendar_events" FOR UPDATE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."calendar_reminder_deliveries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calendar_reminder_deliveries_member_read" ON "public"."calendar_reminder_deliveries" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."calendar_reminders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "calendar_reminders_member_read" ON "public"."calendar_reminders" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."client_interactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_interactions_member_insert" ON "public"."client_interactions" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "client_interactions_member_select" ON "public"."client_interactions" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "client_interactions_member_update" ON "public"."client_interactions" FOR UPDATE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."communication_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "communication_events_member_read" ON "public"."communication_events" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."company_knowledge" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_knowledge_member_select" ON "public"."company_knowledge" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."company_knowledge_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_knowledge_versions_member_select" ON "public"."company_knowledge_versions" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."deals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deals_member_insert" ON "public"."deals" FOR INSERT TO "authenticated" WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "deals_member_select" ON "public"."deals" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "deals_member_update" ON "public"."deals" FOR UPDATE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."files" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."finance_transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."graph_node_positions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."graph_nodes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."graph_relations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lead_clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_clients_member_insert" ON "public"."lead_clients" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "lead_clients_member_select" ON "public"."lead_clients" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "lead_clients_member_update" ON "public"."lead_clients" FOR UPDATE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ((("user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."openclaw_analyses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "openclaw_analyses_member_select" ON "public"."openclaw_analyses" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."openclaw_goals" "g"
  WHERE (("g"."id" = "openclaw_analyses"."goal_id") AND "private"."is_organization_member"("g"."organization_id", ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."openclaw_goals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "openclaw_goals_member_insert" ON "public"."openclaw_goals" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "openclaw_goals_member_select" ON "public"."openclaw_goals" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "openclaw_goals_member_update" ON "public"."openclaw_goals" FOR UPDATE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."openclaw_improvements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "openclaw_improvements_member_select" ON "public"."openclaw_improvements" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."openclaw_goals" "g"
  WHERE (("g"."id" = "openclaw_improvements"."goal_id") AND "private"."is_organization_member"("g"."organization_id", ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."openclaw_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "openclaw_tasks_member_insert" ON "public"."openclaw_tasks" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND "private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "openclaw_tasks_member_select" ON "public"."openclaw_tasks" FOR SELECT TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "openclaw_tasks_member_update" ON "public"."openclaw_tasks" FOR UPDATE TO "authenticated" USING ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK ("private"."is_organization_member"("organization_id", ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_assignees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_checklist_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_label_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_labels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_view_preferences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_watchers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";









GRANT USAGE ON SCHEMA "private" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON TYPE "public"."finance_transaction_type" TO "authenticated";



GRANT ALL ON TYPE "public"."organization_role" TO "authenticated";



GRANT ALL ON TYPE "public"."project_priority" TO "authenticated";



GRANT ALL ON TYPE "public"."project_status" TO "authenticated";



GRANT ALL ON TYPE "public"."task_priority" TO "authenticated";



GRANT ALL ON TYPE "public"."task_status" TO "authenticated";











































































































































































REVOKE ALL ON FUNCTION "private"."archive_ai_user_memory_revision"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."audit_improvement_proposal_status"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."backfill_graph_relations"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."can_manage_project"("target_project_id" "uuid", "target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_manage_project"("target_project_id" "uuid", "target_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."can_manage_task"("target_task_id" "uuid", "target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."can_manage_task"("target_task_id" "uuid", "target_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."graph_artifact_type"("artifact_type" "text", "artifact_metadata" "jsonb", "artifact_url" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."graph_file_type"("file_name" "text", "mime_type" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."graph_project_color"("project_name" "text", "project_id" "uuid") FROM PUBLIC;



GRANT ALL ON FUNCTION "private"."is_organization_member"("target_organization_id" "uuid", "target_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."is_project_member"("target_project_id" "uuid", "target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."is_project_member"("target_project_id" "uuid", "target_user_id" "uuid") TO "authenticated";



GRANT ALL ON FUNCTION "private"."organization_has_members"("target_organization_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."storage_object_organization_id"("object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."storage_object_organization_id"("object_name" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."sync_crm_memory_graph"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."upsert_graph_node"("p_organization_id" "uuid", "p_entity_type" "text", "p_entity_id" "uuid", "p_title" "text", "p_project_id" "uuid", "p_status" "text", "p_metadata" "jsonb", "p_is_automatic" boolean, "p_created_by" "uuid", "p_created_at" timestamp with time zone, "p_position_x" double precision, "p_position_y" double precision) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."upsert_graph_relation"("p_organization_id" "uuid", "p_source_type" "text", "p_source_id" "uuid", "p_target_type" "text", "p_target_id" "uuid", "p_relation_type" "text", "p_direction" "text", "p_strength" real, "p_created_by" "uuid", "p_metadata" "jsonb") FROM PUBLIC;



GRANT ALL ON FUNCTION "private"."user_organization_role"("target_organization_id" "uuid", "target_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "private"."users_share_organization"("left_user_id" "uuid", "right_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."users_share_organization"("left_user_id" "uuid", "right_user_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."apply_knowledge_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_knowledge_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_openclaw_task_webhook"("p_task_id" "uuid", "p_idempotency_key" "text", "p_payload_digest" "text", "p_status" "text", "p_result" "jsonb", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_openclaw_task_webhook"("p_task_id" "uuid", "p_idempotency_key" "text", "p_payload_digest" "text", "p_status" "text", "p_result" "jsonb", "p_error" "text") TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."tasks" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."archive_task"("p_task_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."archive_task"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."archive_task"("p_task_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_knowledge_entry"("p_organization_id" "uuid", "p_slug" "text", "p_title" "text", "p_category" "text", "p_content" "jsonb", "p_created_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_knowledge_entry"("p_organization_id" "uuid", "p_slug" "text", "p_title" "text", "p_category" "text", "p_content" "jsonb", "p_created_by" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."projects" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_project"("p_organization_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_status" "public"."project_status", "p_priority" "public"."project_priority", "p_start_date" "date", "p_due_date" "date", "p_owner_id" "uuid", "p_budget_planned" numeric, "p_currency" "text", "p_member_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_project"("p_organization_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_status" "public"."project_status", "p_priority" "public"."project_priority", "p_start_date" "date", "p_due_date" "date", "p_owner_id" "uuid", "p_budget_planned" numeric, "p_currency" "text", "p_member_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_project"("p_organization_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_status" "public"."project_status", "p_priority" "public"."project_priority", "p_start_date" "date", "p_due_date" "date", "p_owner_id" "uuid", "p_budget_planned" numeric, "p_currency" "text", "p_member_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_task"("p_task_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_task"("p_task_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_task"("p_task_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_lead_clients_by_city"("p_user_id" "uuid", "p_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_lead_clients_by_city"("p_user_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_lead_clients_by_city"("p_user_id" "uuid", "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prepare_calendar_event_reminder"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prepare_calendar_event_reminder"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."process_due_calendar_reminders"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."process_due_calendar_reminders"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."review_improvement_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid", "p_decision" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."review_improvement_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid", "p_decision" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rollback_knowledge_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rollback_knowledge_proposal"("p_proposal_id" "uuid", "p_reviewer_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_task_status_timestamps"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_task_status_timestamps"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_task_status_timestamps"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_calendar_event_reminder"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_calendar_event_reminder"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_project"("p_project_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_status" "public"."project_status", "p_priority" "public"."project_priority", "p_start_date" "date", "p_due_date" "date", "p_owner_id" "uuid", "p_budget_planned" numeric, "p_currency" "text", "p_member_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_project"("p_project_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_status" "public"."project_status", "p_priority" "public"."project_priority", "p_start_date" "date", "p_due_date" "date", "p_owner_id" "uuid", "p_budget_planned" numeric, "p_currency" "text", "p_member_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_project"("p_project_id" "uuid", "p_name" "text", "p_description" "text", "p_color" "text", "p_status" "public"."project_status", "p_priority" "public"."project_priority", "p_start_date" "date", "p_due_date" "date", "p_owner_id" "uuid", "p_budget_planned" numeric, "p_currency" "text", "p_member_ids" "uuid"[]) TO "service_role";
























GRANT ALL ON TABLE "private"."openclaw_webhook_events" TO "service_role";



GRANT ALL ON SEQUENCE "private"."openclaw_webhook_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "private"."openclaw_webhook_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "private"."openclaw_webhook_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_action_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_action_audit" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_action_audit_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_action_audit_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_action_audit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_improvement_proposal_events" TO "service_role";
GRANT SELECT ON TABLE "public"."ai_improvement_proposal_events" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."ai_improvement_proposal_events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_improvement_proposal_events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_improvement_proposal_events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_improvement_proposals" TO "service_role";
GRANT SELECT ON TABLE "public"."ai_improvement_proposals" TO "authenticated";



GRANT ALL ON TABLE "public"."ai_outcomes" TO "service_role";
GRANT SELECT ON TABLE "public"."ai_outcomes" TO "authenticated";



GRANT ALL ON TABLE "public"."ai_user_memory" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_user_memory" TO "service_role";



GRANT ALL ON TABLE "public"."ai_user_memory_revisions" TO "service_role";
GRANT SELECT ON TABLE "public"."ai_user_memory_revisions" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."ai_user_memory_revisions_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_user_memory_revisions_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_user_memory_revisions_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_events" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_events" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_reminder_deliveries" TO "service_role";
GRANT SELECT ON TABLE "public"."calendar_reminder_deliveries" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."calendar_reminder_deliveries_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."calendar_reminder_deliveries_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."calendar_reminder_deliveries_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."calendar_reminders" TO "service_role";
GRANT SELECT ON TABLE "public"."calendar_reminders" TO "authenticated";



GRANT ALL ON TABLE "public"."client_interactions" TO "authenticated";
GRANT ALL ON TABLE "public"."client_interactions" TO "service_role";



GRANT ALL ON TABLE "public"."communication_events" TO "service_role";
GRANT SELECT ON TABLE "public"."communication_events" TO "authenticated";



GRANT ALL ON TABLE "public"."company_knowledge" TO "service_role";
GRANT SELECT ON TABLE "public"."company_knowledge" TO "authenticated";



GRANT ALL ON TABLE "public"."company_knowledge_versions" TO "service_role";
GRANT SELECT ON TABLE "public"."company_knowledge_versions" TO "authenticated";



GRANT ALL ON TABLE "public"."deals" TO "authenticated";
GRANT ALL ON TABLE "public"."deals" TO "service_role";



GRANT ALL ON TABLE "public"."files" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."files" TO "authenticated";



GRANT ALL ON TABLE "public"."finance_transactions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."finance_transactions" TO "authenticated";



GRANT ALL ON TABLE "public"."graph_node_positions" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."graph_node_positions" TO "authenticated";



GRANT ALL ON TABLE "public"."graph_nodes" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."graph_nodes" TO "authenticated";



GRANT ALL ON TABLE "public"."graph_relations" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."graph_relations" TO "authenticated";



GRANT ALL ON TABLE "public"."knowledge_edges" TO "service_role";
GRANT SELECT ON TABLE "public"."knowledge_edges" TO "authenticated";



GRANT ALL ON TABLE "public"."knowledge_nodes" TO "service_role";
GRANT SELECT ON TABLE "public"."knowledge_nodes" TO "authenticated";



GRANT ALL ON TABLE "public"."lead_clients" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_clients" TO "service_role";



GRANT ALL ON TABLE "public"."openclaw_analyses" TO "authenticated";
GRANT ALL ON TABLE "public"."openclaw_analyses" TO "service_role";



GRANT ALL ON TABLE "public"."openclaw_goals" TO "authenticated";
GRANT ALL ON TABLE "public"."openclaw_goals" TO "service_role";



GRANT ALL ON TABLE "public"."openclaw_improvements" TO "authenticated";
GRANT ALL ON TABLE "public"."openclaw_improvements" TO "service_role";



GRANT ALL ON TABLE "public"."openclaw_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."openclaw_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."organization_members" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."organization_members" TO "authenticated";



GRANT ALL ON TABLE "public"."organizations" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."organizations" TO "authenticated";



GRANT ALL ON TABLE "public"."profiles" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."project_links" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."project_links" TO "authenticated";



GRANT ALL ON TABLE "public"."project_members" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."project_members" TO "authenticated";



GRANT ALL ON TABLE "public"."task_assignees" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."task_assignees" TO "authenticated";



GRANT ALL ON TABLE "public"."task_checklist_items" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_checklist_items" TO "authenticated";



GRANT ALL ON TABLE "public"."task_comments" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_comments" TO "authenticated";



GRANT ALL ON TABLE "public"."task_label_links" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."task_label_links" TO "authenticated";



GRANT ALL ON TABLE "public"."task_labels" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_labels" TO "authenticated";



GRANT ALL ON TABLE "public"."task_view_preferences" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."task_view_preferences" TO "authenticated";



GRANT ALL ON TABLE "public"."task_watchers" TO "service_role";
GRANT SELECT,INSERT,DELETE ON TABLE "public"."task_watchers" TO "authenticated";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";

revoke references on table "public"."ai_action_audit" from "anon";

revoke trigger on table "public"."ai_action_audit" from "anon";

revoke truncate on table "public"."ai_action_audit" from "anon";

revoke references on table "public"."ai_improvement_proposal_events" from "anon";

revoke trigger on table "public"."ai_improvement_proposal_events" from "anon";

revoke truncate on table "public"."ai_improvement_proposal_events" from "anon";

revoke references on table "public"."ai_improvement_proposal_events" from "authenticated";

revoke trigger on table "public"."ai_improvement_proposal_events" from "authenticated";

revoke truncate on table "public"."ai_improvement_proposal_events" from "authenticated";

revoke references on table "public"."ai_improvement_proposals" from "anon";

revoke trigger on table "public"."ai_improvement_proposals" from "anon";

revoke truncate on table "public"."ai_improvement_proposals" from "anon";

revoke references on table "public"."ai_improvement_proposals" from "authenticated";

revoke trigger on table "public"."ai_improvement_proposals" from "authenticated";

revoke truncate on table "public"."ai_improvement_proposals" from "authenticated";

revoke references on table "public"."ai_outcomes" from "anon";

revoke trigger on table "public"."ai_outcomes" from "anon";

revoke truncate on table "public"."ai_outcomes" from "anon";

revoke references on table "public"."ai_outcomes" from "authenticated";

revoke trigger on table "public"."ai_outcomes" from "authenticated";

revoke truncate on table "public"."ai_outcomes" from "authenticated";

revoke references on table "public"."ai_user_memory" from "anon";

revoke trigger on table "public"."ai_user_memory" from "anon";

revoke truncate on table "public"."ai_user_memory" from "anon";

revoke references on table "public"."ai_user_memory_revisions" from "anon";

revoke trigger on table "public"."ai_user_memory_revisions" from "anon";

revoke truncate on table "public"."ai_user_memory_revisions" from "anon";

revoke references on table "public"."ai_user_memory_revisions" from "authenticated";

revoke trigger on table "public"."ai_user_memory_revisions" from "authenticated";

revoke truncate on table "public"."ai_user_memory_revisions" from "authenticated";

revoke references on table "public"."calendar_events" from "anon";

revoke trigger on table "public"."calendar_events" from "anon";

revoke truncate on table "public"."calendar_events" from "anon";

revoke references on table "public"."calendar_reminder_deliveries" from "anon";

revoke trigger on table "public"."calendar_reminder_deliveries" from "anon";

revoke truncate on table "public"."calendar_reminder_deliveries" from "anon";

revoke references on table "public"."calendar_reminder_deliveries" from "authenticated";

revoke trigger on table "public"."calendar_reminder_deliveries" from "authenticated";

revoke truncate on table "public"."calendar_reminder_deliveries" from "authenticated";

revoke references on table "public"."calendar_reminders" from "anon";

revoke trigger on table "public"."calendar_reminders" from "anon";

revoke truncate on table "public"."calendar_reminders" from "anon";

revoke references on table "public"."calendar_reminders" from "authenticated";

revoke trigger on table "public"."calendar_reminders" from "authenticated";

revoke truncate on table "public"."calendar_reminders" from "authenticated";

revoke references on table "public"."client_interactions" from "anon";

revoke trigger on table "public"."client_interactions" from "anon";

revoke truncate on table "public"."client_interactions" from "anon";

revoke references on table "public"."communication_events" from "anon";

revoke trigger on table "public"."communication_events" from "anon";

revoke truncate on table "public"."communication_events" from "anon";

revoke references on table "public"."communication_events" from "authenticated";

revoke trigger on table "public"."communication_events" from "authenticated";

revoke truncate on table "public"."communication_events" from "authenticated";

revoke references on table "public"."company_knowledge" from "anon";

revoke trigger on table "public"."company_knowledge" from "anon";

revoke truncate on table "public"."company_knowledge" from "anon";

revoke references on table "public"."company_knowledge" from "authenticated";

revoke trigger on table "public"."company_knowledge" from "authenticated";

revoke truncate on table "public"."company_knowledge" from "authenticated";

revoke references on table "public"."company_knowledge_versions" from "anon";

revoke trigger on table "public"."company_knowledge_versions" from "anon";

revoke truncate on table "public"."company_knowledge_versions" from "anon";

revoke references on table "public"."company_knowledge_versions" from "authenticated";

revoke trigger on table "public"."company_knowledge_versions" from "authenticated";

revoke truncate on table "public"."company_knowledge_versions" from "authenticated";

revoke references on table "public"."deals" from "anon";

revoke trigger on table "public"."deals" from "anon";

revoke truncate on table "public"."deals" from "anon";

revoke references on table "public"."files" from "anon";

revoke trigger on table "public"."files" from "anon";

revoke truncate on table "public"."files" from "anon";

revoke references on table "public"."files" from "authenticated";

revoke trigger on table "public"."files" from "authenticated";

revoke truncate on table "public"."files" from "authenticated";

revoke references on table "public"."finance_transactions" from "anon";

revoke trigger on table "public"."finance_transactions" from "anon";

revoke truncate on table "public"."finance_transactions" from "anon";

revoke references on table "public"."finance_transactions" from "authenticated";

revoke trigger on table "public"."finance_transactions" from "authenticated";

revoke truncate on table "public"."finance_transactions" from "authenticated";

revoke references on table "public"."graph_node_positions" from "anon";

revoke trigger on table "public"."graph_node_positions" from "anon";

revoke truncate on table "public"."graph_node_positions" from "anon";

revoke references on table "public"."graph_node_positions" from "authenticated";

revoke trigger on table "public"."graph_node_positions" from "authenticated";

revoke truncate on table "public"."graph_node_positions" from "authenticated";

revoke references on table "public"."graph_nodes" from "anon";

revoke trigger on table "public"."graph_nodes" from "anon";

revoke truncate on table "public"."graph_nodes" from "anon";

revoke references on table "public"."graph_nodes" from "authenticated";

revoke trigger on table "public"."graph_nodes" from "authenticated";

revoke truncate on table "public"."graph_nodes" from "authenticated";

revoke references on table "public"."graph_relations" from "anon";

revoke trigger on table "public"."graph_relations" from "anon";

revoke truncate on table "public"."graph_relations" from "anon";

revoke references on table "public"."graph_relations" from "authenticated";

revoke trigger on table "public"."graph_relations" from "authenticated";

revoke truncate on table "public"."graph_relations" from "authenticated";

revoke references on table "public"."lead_clients" from "anon";

revoke trigger on table "public"."lead_clients" from "anon";

revoke truncate on table "public"."lead_clients" from "anon";

revoke references on table "public"."openclaw_analyses" from "anon";

revoke trigger on table "public"."openclaw_analyses" from "anon";

revoke truncate on table "public"."openclaw_analyses" from "anon";

revoke references on table "public"."openclaw_goals" from "anon";

revoke trigger on table "public"."openclaw_goals" from "anon";

revoke truncate on table "public"."openclaw_goals" from "anon";

revoke references on table "public"."openclaw_improvements" from "anon";

revoke trigger on table "public"."openclaw_improvements" from "anon";

revoke truncate on table "public"."openclaw_improvements" from "anon";

revoke references on table "public"."openclaw_tasks" from "anon";

revoke trigger on table "public"."openclaw_tasks" from "anon";

revoke truncate on table "public"."openclaw_tasks" from "anon";

revoke references on table "public"."organization_members" from "anon";

revoke trigger on table "public"."organization_members" from "anon";

revoke truncate on table "public"."organization_members" from "anon";

revoke references on table "public"."organization_members" from "authenticated";

revoke trigger on table "public"."organization_members" from "authenticated";

revoke truncate on table "public"."organization_members" from "authenticated";

revoke references on table "public"."organizations" from "anon";

revoke trigger on table "public"."organizations" from "anon";

revoke truncate on table "public"."organizations" from "anon";

revoke references on table "public"."organizations" from "authenticated";

revoke trigger on table "public"."organizations" from "authenticated";

revoke truncate on table "public"."organizations" from "authenticated";

revoke references on table "public"."profiles" from "anon";

revoke trigger on table "public"."profiles" from "anon";

revoke truncate on table "public"."profiles" from "anon";

revoke references on table "public"."profiles" from "authenticated";

revoke trigger on table "public"."profiles" from "authenticated";

revoke truncate on table "public"."profiles" from "authenticated";

revoke references on table "public"."project_links" from "anon";

revoke trigger on table "public"."project_links" from "anon";

revoke truncate on table "public"."project_links" from "anon";

revoke references on table "public"."project_links" from "authenticated";

revoke trigger on table "public"."project_links" from "authenticated";

revoke truncate on table "public"."project_links" from "authenticated";

revoke references on table "public"."project_members" from "anon";

revoke trigger on table "public"."project_members" from "anon";

revoke truncate on table "public"."project_members" from "anon";

revoke references on table "public"."project_members" from "authenticated";

revoke trigger on table "public"."project_members" from "authenticated";

revoke truncate on table "public"."project_members" from "authenticated";

revoke references on table "public"."projects" from "anon";

revoke trigger on table "public"."projects" from "anon";

revoke truncate on table "public"."projects" from "anon";

revoke references on table "public"."projects" from "authenticated";

revoke trigger on table "public"."projects" from "authenticated";

revoke truncate on table "public"."projects" from "authenticated";

revoke references on table "public"."task_assignees" from "anon";

revoke trigger on table "public"."task_assignees" from "anon";

revoke truncate on table "public"."task_assignees" from "anon";

revoke references on table "public"."task_assignees" from "authenticated";

revoke trigger on table "public"."task_assignees" from "authenticated";

revoke truncate on table "public"."task_assignees" from "authenticated";

revoke references on table "public"."task_checklist_items" from "anon";

revoke trigger on table "public"."task_checklist_items" from "anon";

revoke truncate on table "public"."task_checklist_items" from "anon";

revoke references on table "public"."task_checklist_items" from "authenticated";

revoke trigger on table "public"."task_checklist_items" from "authenticated";

revoke truncate on table "public"."task_checklist_items" from "authenticated";

revoke references on table "public"."task_comments" from "anon";

revoke trigger on table "public"."task_comments" from "anon";

revoke truncate on table "public"."task_comments" from "anon";

revoke references on table "public"."task_comments" from "authenticated";

revoke trigger on table "public"."task_comments" from "authenticated";

revoke truncate on table "public"."task_comments" from "authenticated";

revoke references on table "public"."task_label_links" from "anon";

revoke trigger on table "public"."task_label_links" from "anon";

revoke truncate on table "public"."task_label_links" from "anon";

revoke references on table "public"."task_label_links" from "authenticated";

revoke trigger on table "public"."task_label_links" from "authenticated";

revoke truncate on table "public"."task_label_links" from "authenticated";

revoke references on table "public"."task_labels" from "anon";

revoke trigger on table "public"."task_labels" from "anon";

revoke truncate on table "public"."task_labels" from "anon";

revoke references on table "public"."task_labels" from "authenticated";

revoke trigger on table "public"."task_labels" from "authenticated";

revoke truncate on table "public"."task_labels" from "authenticated";

revoke references on table "public"."task_view_preferences" from "anon";

revoke trigger on table "public"."task_view_preferences" from "anon";

revoke truncate on table "public"."task_view_preferences" from "anon";

revoke references on table "public"."task_view_preferences" from "authenticated";

revoke trigger on table "public"."task_view_preferences" from "authenticated";

revoke truncate on table "public"."task_view_preferences" from "authenticated";

revoke references on table "public"."task_watchers" from "anon";

revoke trigger on table "public"."task_watchers" from "anon";

revoke truncate on table "public"."task_watchers" from "anon";

revoke references on table "public"."task_watchers" from "authenticated";

revoke trigger on table "public"."task_watchers" from "authenticated";

revoke truncate on table "public"."task_watchers" from "authenticated";

revoke references on table "public"."tasks" from "anon";

revoke trigger on table "public"."tasks" from "anon";

revoke truncate on table "public"."tasks" from "anon";

revoke references on table "public"."tasks" from "authenticated";

revoke trigger on table "public"."tasks" from "authenticated";

revoke truncate on table "public"."tasks" from "authenticated";

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  create policy "Organization members can delete task storage objects"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'task-files'::text) AND private.is_organization_member(private.storage_object_organization_id(name), ( SELECT auth.uid() AS uid))));



  create policy "Organization members can read task storage objects"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'task-files'::text) AND private.is_organization_member(private.storage_object_organization_id(name), ( SELECT auth.uid() AS uid))));



  create policy "Organization members can update task storage objects"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'task-files'::text) AND private.is_organization_member(private.storage_object_organization_id(name), ( SELECT auth.uid() AS uid))))
with check (((bucket_id = 'task-files'::text) AND private.is_organization_member(private.storage_object_organization_id(name), ( SELECT auth.uid() AS uid))));



  create policy "Organization members can upload task storage objects"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'task-files'::text) AND private.is_organization_member(private.storage_object_organization_id(name), ( SELECT auth.uid() AS uid))));



