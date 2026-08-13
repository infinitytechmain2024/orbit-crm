-- Universal, organization-scoped knowledge graph for Orbit CRM.
-- The graph keeps a durable node for every supported CRM entity while the
-- source tables remain the system of record. Trigger-created rows are marked
-- automatic and cannot be edited or deleted directly by browser users.

create or replace function private.graph_project_color(project_name text, project_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
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

create or replace function private.graph_file_type(file_name text, mime_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(file_name, '')) ~ '\.(fig|sketch|psd|ai|xd)$' then 'design'
    when lower(coalesce(mime_type, '')) like 'image/%' then 'image'
    when lower(coalesce(mime_type, '')) similar to '%(pdf|word|document|sheet|excel|text)%'
      then 'document'
    else 'file'
  end;
$$;

create or replace function private.graph_artifact_type(
  artifact_type text,
  artifact_metadata jsonb,
  artifact_url text
)
returns text
language sql
immutable
set search_path = ''
as $$
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
$$;

create table if not exists public.graph_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_type text not null check (entity_type ~ '^[a-z][a-z0-9_]{1,63}$'),
  entity_id uuid not null,
  title text not null check (char_length(trim(title)) between 1 and 500),
  project_id uuid,
  status text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  position_x double precision,
  position_y double precision,
  is_automatic boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, entity_type, entity_id),
  unique (organization_id, id),
  foreign key (organization_id, project_id)
    references public.projects(organization_id, id) on delete set null
);

create table if not exists public.graph_relations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  relation_type text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.graph_node_positions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  node_type text not null,
  node_id uuid not null,
  x_position double precision not null,
  y_position double precision not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, node_type, node_id)
);

drop view if exists public.knowledge_edges;
drop view if exists public.knowledge_nodes;

-- Drop the v1 policies before widening enum-backed endpoint columns to text.
drop policy if exists "Members can read visible graph relations" on public.graph_relations;
drop policy if exists "Members can create visible graph relations" on public.graph_relations;
drop policy if exists "Creators and managers can delete graph relations" on public.graph_relations;
drop policy if exists "Members can read graph relations" on public.graph_relations;
drop policy if exists "Members can create manual graph relations" on public.graph_relations;
drop policy if exists "Members can update manual graph relations" on public.graph_relations;
drop policy if exists "Members can delete manual graph relations" on public.graph_relations;

alter table public.graph_relations
  drop constraint if exists graph_relations_unique_edge,
  drop constraint if exists graph_relations_distinct_endpoints_check;

alter table public.graph_relations
  add column if not exists source_node_id uuid,
  add column if not exists target_node_id uuid,
  add column if not exists direction text not null default 'one_way',
  add column if not exists strength real not null default 1,
  add column if not exists is_automatic boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.graph_relations alter column source_type type text using source_type::text;
alter table public.graph_relations alter column target_type type text using target_type::text;
alter table public.graph_relations alter column relation_type type text using relation_type::text;
alter table public.graph_relations alter column created_by drop not null;

alter table public.graph_relations
  drop constraint if exists graph_relations_direction_check,
  drop constraint if exists graph_relations_strength_check,
  drop constraint if exists graph_relations_metadata_check,
  drop constraint if exists graph_relations_endpoint_type_check,
  drop constraint if exists graph_relations_relation_type_check;

alter table public.graph_relations
  add constraint graph_relations_direction_check
    check (direction in ('one_way', 'two_way')),
  add constraint graph_relations_strength_check
    check (strength > 0 and strength <= 10),
  add constraint graph_relations_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  add constraint graph_relations_distinct_endpoints_check
    check ((source_type, source_id) <> (target_type, target_id)),
  add constraint graph_relations_endpoint_type_check
    check (
      source_type ~ '^[a-z][a-z0-9_]{1,63}$'
      and target_type ~ '^[a-z][a-z0-9_]{1,63}$'
    ),
  add constraint graph_relations_relation_type_check
    check (relation_type in (
      'belongs_to', 'contains', 'assigned_to', 'created_by', 'created_from',
      'generated_from_prompt', 'uses', 'used_in', 'adapted_for', 'related_to',
      'depends_on', 'blocks', 'requires_approval', 'approved_by', 'communicates_with'
    ));

drop policy if exists "Users can read their graph positions" on public.graph_node_positions;
drop policy if exists "Users can create their graph positions" on public.graph_node_positions;
drop policy if exists "Users can update their graph positions" on public.graph_node_positions;
drop policy if exists "Users can delete their graph positions" on public.graph_node_positions;

alter table public.graph_node_positions alter column node_type type text using node_type::text;

create or replace function private.upsert_graph_node(
  p_organization_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_project_id uuid,
  p_status text,
  p_metadata jsonb,
  p_is_automatic boolean,
  p_created_by uuid,
  p_created_at timestamptz,
  p_position_x double precision default null,
  p_position_y double precision default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.upsert_graph_relation(
  p_organization_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_relation_type text,
  p_direction text,
  p_strength real,
  p_created_by uuid,
  p_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

-- Seed durable nodes from every currently deployed Orbit entity table.
insert into public.graph_nodes (
  organization_id, entity_type, entity_id, title, metadata,
  is_automatic, created_by, created_at
)
select member.organization_id, 'person', member.user_id,
       coalesce(nullif(profile.full_name, ''), nullif(profile.email, ''), 'Участник команды'),
       jsonb_build_object('role', member.role, 'email', profile.email, 'avatar_url', profile.avatar_url),
       true, coalesce(member.created_by, organization.created_by), member.created_at
from public.organization_members member
join public.organizations organization on organization.id = member.organization_id
left join public.profiles profile on profile.id = member.user_id
on conflict (organization_id, entity_type, entity_id) do update
set title = excluded.title, metadata = public.graph_nodes.metadata || excluded.metadata, updated_at = now();

insert into public.graph_nodes (
  organization_id, entity_type, entity_id, title, project_id, status, metadata,
  position_x, position_y, is_automatic, created_by, created_at
)
select project.organization_id, 'project', project.id, project.name, project.id, project.status::text,
       jsonb_build_object(
         'description', project.description,
         'priority', project.priority,
         'due_date', project.due_date,
         'project_color', private.graph_project_color(project.name, project.id)
       ),
       180 + ((row_number() over (partition by project.organization_id order by project.created_at) - 1) % 4) * 310,
       120 + floor((row_number() over (partition by project.organization_id order by project.created_at) - 1) / 4) * 260,
       true, project.created_by, project.created_at
from public.projects project
on conflict (organization_id, entity_type, entity_id) do update
set title = excluded.title, project_id = excluded.project_id, status = excluded.status,
    metadata = public.graph_nodes.metadata || excluded.metadata, updated_at = now();

insert into public.graph_nodes (
  organization_id, entity_type, entity_id, title, project_id, status, metadata,
  is_automatic, created_by, created_at
)
select task.organization_id, 'task', task.id, task.title, task.project_id, task.status,
       jsonb_build_object(
         'description', coalesce(task.description, task.note),
         'priority', task.priority,
         'due_date', task.due_date,
         'completed_at', task.completed_at
       ),
       true, task.author_id, task.created_at
from public.tasks task
on conflict (organization_id, entity_type, entity_id) do update
set title = excluded.title, project_id = excluded.project_id, status = excluded.status,
    metadata = public.graph_nodes.metadata || excluded.metadata, updated_at = now();

insert into public.graph_nodes (
  organization_id, entity_type, entity_id, title, project_id, status, metadata,
  is_automatic, created_by, created_at
)
select comment.organization_id, 'message', comment.id,
       left(regexp_replace(comment.body, '\s+', ' ', 'g'), 500), task.project_id, null,
       jsonb_build_object('task_id', comment.task_id, 'kind', 'task_comment'),
       true, comment.created_by, comment.created_at
from public.task_comments comment
join public.tasks task on task.organization_id = comment.organization_id and task.id = comment.task_id
on conflict (organization_id, entity_type, entity_id) do update
set title = excluded.title, project_id = excluded.project_id,
    metadata = public.graph_nodes.metadata || excluded.metadata, updated_at = now();

insert into public.graph_nodes (
  organization_id, entity_type, entity_id, title, project_id, status, metadata,
  is_automatic, created_by, created_at
)
select item.organization_id, 'checklist_item', item.id, item.title, task.project_id,
       case when item.completed_at is null then 'active' else 'completed' end,
       jsonb_build_object('task_id', item.task_id, 'completed_at', item.completed_at),
       true, item.created_by, item.created_at
from public.task_checklist_items item
join public.tasks task on task.organization_id = item.organization_id and task.id = item.task_id
on conflict (organization_id, entity_type, entity_id) do update
set title = excluded.title, project_id = excluded.project_id, status = excluded.status,
    metadata = public.graph_nodes.metadata || excluded.metadata, updated_at = now();

insert into public.graph_nodes (
  organization_id, entity_type, entity_id, title, project_id, metadata,
  is_automatic, created_by, created_at
)
select file.organization_id, private.graph_file_type(file.file_name, file.mime_type), file.id,
       file.file_name, task.project_id,
       jsonb_build_object(
         'task_id', file.task_id, 'mime_type', file.mime_type,
         'size_bytes', file.size_bytes, 'storage_path', file.storage_path
       ),
       true, file.uploaded_by, file.created_at
from public.files file
join public.tasks task on task.organization_id = file.organization_id and task.id = file.task_id
on conflict (organization_id, entity_type, entity_id) do update
set title = excluded.title, project_id = excluded.project_id,
    metadata = public.graph_nodes.metadata || excluded.metadata, updated_at = now();

insert into public.graph_nodes (
  organization_id, entity_type, entity_id, title, project_id, status, metadata,
  is_automatic, created_by, created_at
)
select transaction.organization_id, 'finance', transaction.id, transaction.label,
       task.project_id, transaction.type::text,
       jsonb_build_object(
         'task_id', transaction.task_id, 'amount', transaction.amount,
         'category', transaction.category, 'currency', task.currency
       ),
       true, transaction.created_by, transaction.created_at
from public.finance_transactions transaction
left join public.tasks task
  on task.organization_id = transaction.organization_id and task.id = transaction.task_id
on conflict (organization_id, entity_type, entity_id) do update
set title = excluded.title, project_id = excluded.project_id, status = excluded.status,
    metadata = public.graph_nodes.metadata || excluded.metadata, updated_at = now();

-- Preserve endpoints from v1 relations by materializing any missing generic nodes.
insert into public.graph_nodes (
  organization_id, entity_type, entity_id, title, is_automatic, created_by, created_at
)
select relation.organization_id, endpoint.entity_type, endpoint.entity_id,
       initcap(replace(endpoint.entity_type, '_', ' ')), false, relation.created_by, relation.created_at
from public.graph_relations relation
cross join lateral (
  values (relation.source_type, relation.source_id), (relation.target_type, relation.target_id)
) endpoint(entity_type, entity_id)
where endpoint.entity_id is not null
on conflict (organization_id, entity_type, entity_id) do nothing;

update public.graph_relations relation
set source_node_id = source.id,
    target_node_id = target.id
from public.graph_nodes source, public.graph_nodes target
where source.organization_id = relation.organization_id
  and source.entity_type = relation.source_type
  and source.entity_id = relation.source_id
  and target.organization_id = relation.organization_id
  and target.entity_type = relation.target_type
  and target.entity_id = relation.target_id;

alter table public.graph_relations alter column source_node_id set not null;
alter table public.graph_relations alter column target_node_id set not null;

alter table public.graph_relations
  drop constraint if exists graph_relations_source_node_fkey,
  drop constraint if exists graph_relations_target_node_fkey,
  drop constraint if exists graph_relations_unique_node_edge;

alter table public.graph_relations
  add constraint graph_relations_source_node_fkey
    foreign key (organization_id, source_node_id)
    references public.graph_nodes(organization_id, id) on delete cascade,
  add constraint graph_relations_target_node_fkey
    foreign key (organization_id, target_node_id)
    references public.graph_nodes(organization_id, id) on delete cascade,
  add constraint graph_relations_unique_node_edge
    unique (organization_id, source_node_id, target_node_id, relation_type, direction);

create or replace function private.normalize_graph_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

drop trigger if exists normalize_graph_relation on public.graph_relations;
create trigger normalize_graph_relation
  before insert or update on public.graph_relations
  for each row execute function private.normalize_graph_relation();

-- Automatic synchronization for projects, tasks, people and native materials.
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

create or replace function private.sync_graph_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.sync_graph_organization_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.sync_graph_project_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.sync_graph_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.sync_graph_project_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.sync_graph_file()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.sync_graph_task_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.sync_graph_checklist_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.sync_graph_finance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

drop trigger if exists sync_graph_project on public.projects;
create trigger sync_graph_project
  after insert or update or delete on public.projects
  for each row execute function private.sync_graph_project();

drop trigger if exists sync_graph_task on public.tasks;
create trigger sync_graph_task
  after insert or update or delete on public.tasks
  for each row execute function private.sync_graph_task();

drop trigger if exists sync_graph_organization_member on public.organization_members;
create trigger sync_graph_organization_member
  after insert or update or delete on public.organization_members
  for each row execute function private.sync_graph_organization_member();

drop trigger if exists sync_graph_project_member on public.project_members;
create trigger sync_graph_project_member
  after insert or delete on public.project_members
  for each row execute function private.sync_graph_project_member();

drop trigger if exists sync_graph_task_assignee on public.task_assignees;
create trigger sync_graph_task_assignee
  after insert or delete on public.task_assignees
  for each row execute function private.sync_graph_task_assignee();

drop trigger if exists sync_graph_project_link on public.project_links;
create trigger sync_graph_project_link
  after insert or update or delete on public.project_links
  for each row execute function private.sync_graph_project_link();

drop trigger if exists sync_graph_file on public.files;
create trigger sync_graph_file
  after insert or update or delete on public.files
  for each row execute function private.sync_graph_file();

drop trigger if exists sync_graph_task_comment on public.task_comments;
create trigger sync_graph_task_comment
  after insert or update or delete on public.task_comments
  for each row execute function private.sync_graph_task_comment();

drop trigger if exists sync_graph_checklist_item on public.task_checklist_items;
create trigger sync_graph_checklist_item
  after insert or update or delete on public.task_checklist_items
  for each row execute function private.sync_graph_checklist_item();

drop trigger if exists sync_graph_finance on public.finance_transactions;
create trigger sync_graph_finance
  after insert or update or delete on public.finance_transactions
  for each row execute function private.sync_graph_finance();

-- Helper used only for deterministic migration backfill (trigger functions
-- cannot be called directly because NEW/OLD are unavailable outside triggers).
create or replace function private.backfill_graph_relations()
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

select private.backfill_graph_relations();

-- Optional AI Workflow sources are installed conditionally so this migration
-- works against both the current production schema and newer local schemas.
create or replace function private.sync_graph_ai_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.sync_graph_ai_agent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

create or replace function private.sync_graph_artifact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

do $$
begin
  if to_regclass('public.ai_agents') is not null then
    execute 'drop trigger if exists sync_graph_ai_agent on public.ai_agents';
    execute 'create trigger sync_graph_ai_agent after insert or update or delete on public.ai_agents for each row execute function private.sync_graph_ai_agent()';
  end if;
  if to_regclass('public.ai_tasks') is not null then
    execute 'drop trigger if exists sync_graph_ai_task on public.ai_tasks';
    execute 'create trigger sync_graph_ai_task after insert or update or delete on public.ai_tasks for each row execute function private.sync_graph_ai_task()';
  end if;
  if to_regclass('public.artifacts') is not null then
    execute 'drop trigger if exists sync_graph_artifact on public.artifacts';
    execute 'create trigger sync_graph_artifact after insert or update or delete on public.artifacts for each row execute function private.sync_graph_artifact()';
  end if;
end $$;

create index if not exists graph_nodes_type_lookup_idx
  on public.graph_nodes (organization_id, entity_type, updated_at desc);
create index if not exists graph_nodes_project_lookup_idx
  on public.graph_nodes (organization_id, project_id, entity_type, updated_at desc)
  where project_id is not null;
create index if not exists graph_nodes_title_search_idx
  on public.graph_nodes (organization_id, lower(title) text_pattern_ops);
create index if not exists graph_nodes_created_by_idx
  on public.graph_nodes (created_by) where created_by is not null;
create index if not exists graph_relations_source_node_idx
  on public.graph_relations (organization_id, source_node_id, updated_at desc);
create index if not exists graph_relations_target_node_idx
  on public.graph_relations (organization_id, target_node_id, updated_at desc);
create index if not exists graph_relations_manual_idx
  on public.graph_relations (organization_id, created_by, updated_at desc)
  where not is_automatic;
create index if not exists graph_relations_created_by_v2_idx
  on public.graph_relations (created_by) where created_by is not null;
create index if not exists graph_node_positions_user_lookup_idx
  on public.graph_node_positions (user_id, organization_id);

drop trigger if exists set_graph_nodes_updated_at on public.graph_nodes;
create trigger set_graph_nodes_updated_at
  before update on public.graph_nodes
  for each row execute function public.set_updated_at();
drop trigger if exists set_graph_relations_updated_at on public.graph_relations;
create trigger set_graph_relations_updated_at
  before update on public.graph_relations
  for each row execute function public.set_updated_at();
drop trigger if exists set_graph_node_positions_updated_at on public.graph_node_positions;
create trigger set_graph_node_positions_updated_at
  before update on public.graph_node_positions
  for each row execute function public.set_updated_at();

alter table public.graph_nodes enable row level security;
alter table public.graph_relations enable row level security;
alter table public.graph_node_positions enable row level security;

drop policy if exists "Members can read graph nodes" on public.graph_nodes;
drop policy if exists "Members can create manual graph nodes" on public.graph_nodes;
drop policy if exists "Members can update manual graph nodes" on public.graph_nodes;
drop policy if exists "Members can delete manual graph nodes" on public.graph_nodes;

create policy "Members can read graph nodes"
  on public.graph_nodes for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create manual graph nodes"
  on public.graph_nodes for insert to authenticated
  with check (
    not is_automatic
    and created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can update manual graph nodes"
  on public.graph_nodes for update to authenticated
  using (
    not is_automatic
    and private.is_organization_member(organization_id, (select auth.uid()))
    and (
      created_by = (select auth.uid())
      or private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin', 'manager')
    )
  )
  with check (
    not is_automatic
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can delete manual graph nodes"
  on public.graph_nodes for delete to authenticated
  using (
    not is_automatic
    and private.is_organization_member(organization_id, (select auth.uid()))
    and (
      created_by = (select auth.uid())
      or private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin', 'manager')
    )
  );

create policy "Members can read graph relations"
  on public.graph_relations for select to authenticated
  using (private.is_organization_member(organization_id, (select auth.uid())));

create policy "Members can create manual graph relations"
  on public.graph_relations for insert to authenticated
  with check (
    not is_automatic
    and created_by = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can update manual graph relations"
  on public.graph_relations for update to authenticated
  using (
    not is_automatic
    and private.is_organization_member(organization_id, (select auth.uid()))
    and (
      created_by = (select auth.uid())
      or private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin', 'manager')
    )
  )
  with check (
    not is_automatic
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

create policy "Members can delete manual graph relations"
  on public.graph_relations for delete to authenticated
  using (
    not is_automatic
    and private.is_organization_member(organization_id, (select auth.uid()))
    and (
      created_by = (select auth.uid())
      or private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin', 'manager')
    )
  );

create policy "Users can read their graph positions"
  on public.graph_node_positions for select to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );
create policy "Users can create their graph positions"
  on public.graph_node_positions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );
create policy "Users can update their graph positions"
  on public.graph_node_positions for update to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );
create policy "Users can delete their graph positions"
  on public.graph_node_positions for delete to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id, (select auth.uid()))
  );

revoke all on table public.graph_nodes from anon, authenticated;
revoke all on table public.graph_relations from anon, authenticated;
revoke all on table public.graph_node_positions from anon, authenticated;
grant select, insert, update, delete on table public.graph_nodes to authenticated;
grant select, insert, update, delete on table public.graph_relations to authenticated;
grant select, insert, update, delete on table public.graph_node_positions to authenticated;

revoke execute on function private.graph_project_color(text, uuid) from public, anon, authenticated;
revoke execute on function private.graph_file_type(text, text) from public, anon, authenticated;
revoke execute on function private.graph_artifact_type(text, jsonb, text) from public, anon, authenticated;
revoke execute on function private.upsert_graph_node(uuid, text, uuid, text, uuid, text, jsonb, boolean, uuid, timestamptz, double precision, double precision) from public, anon, authenticated;
revoke execute on function private.upsert_graph_relation(uuid, text, uuid, text, uuid, text, text, real, uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.backfill_graph_relations() from public, anon, authenticated;

create or replace view public.knowledge_nodes
with (security_invoker = true)
as
select organization_id, entity_id as id, entity_type as node_type, title, status,
       created_at,
       metadata || jsonb_build_object(
         'graph_node_id', graph_nodes.id,
         'project_id', project_id,
         'position_x', position_x,
         'position_y', position_y,
         'is_automatic', is_automatic
       ) as metadata
from public.graph_nodes;

create or replace view public.knowledge_edges
with (security_invoker = true)
as select * from public.graph_relations;

revoke all on table public.knowledge_nodes from anon, authenticated;
revoke all on table public.knowledge_edges from anon, authenticated;
grant select on table public.knowledge_nodes to authenticated;
grant select on table public.knowledge_edges to authenticated;

comment on table public.graph_nodes is
  'Universal organization-scoped knowledge graph nodes synchronized from Orbit CRM source entities.';
comment on table public.graph_relations is
  'Directed manual and automatic knowledge graph relations. Automatic rows are source-controlled by triggers.';
comment on column public.graph_relations.direction is
  'one_way renders one directed arc; two_way renders two separate opposing arcs.';
