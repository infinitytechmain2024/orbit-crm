-- Migration: Интеграция «Выгрузки мыслей» с AI Workflow (prompt requirement 3.A + 3.В)
-- Добавляет поля диспетчеризации к public.tasks и связывает выгрузку с Orbit Commander

-- 1. Расширение таблицы tasks
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='source'
  ) then
    alter table public.tasks add column source text not null default 'manual';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='workflow_status'
  ) then
    alter table public.tasks add column workflow_status text not null default 'manual'
      check (workflow_status in ('pending_dispatch','dispatched','manual','failed'));
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='target_role'
  ) then
    alter table public.tasks add column target_role text;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='dispatch_to_workflow'
  ) then
    alter table public.tasks add column dispatch_to_workflow boolean not null default false;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='tasks' and column_name='ai_workflow_task_id'
  ) then
    alter table public.tasks add column ai_workflow_task_id uuid references public.ai_tasks(id) on delete set null;
  end if;
end $$;

-- Нормализовать значения по умолчанию
alter table public.tasks alter column source set default 'manual';
alter table public.tasks alter column workflow_status set default 'manual';

-- Индексы для диспетчеризации
create index if not exists tasks_workflow_dispatch_idx
  on public.tasks(organization_id, workflow_status, dispatch_to_workflow)
  where dispatch_to_workflow = true;
create index if not exists tasks_source_idx
  on public.tasks(organization_id, source)
  where source = 'ai_brain_dump';
create index if not exists tasks_target_role_idx
  on public.tasks(organization_id, target_role)
  where target_role is not null;

comment on column public.tasks.source is 'Происхождение задачи: manual | ai_brain_dump | workflow | import';
comment on column public.tasks.workflow_status is 'Статус диспетчеризации в AI Workflow: manual | pending_dispatch | dispatched | failed';
comment on column public.tasks.target_role is 'Целевая роль/отдел для C-level маршрутизации (Development, Marketing, HR, etc.)';
comment on column public.tasks.dispatch_to_workflow is 'Флаг передачи в конвейер AI Workflow (Orbit Commander)';
comment on column public.tasks.ai_workflow_task_id is 'Связь с ai_tasks для сквозной трассировки Brain Dump → Workflow';

-- 2. Связь: храним соответствие CRM task → Workflow task в metadata ai_tasks
-- ai_tasks уже имеет source / source_entity_type / source_entity_id — используем их
-- Дополнительно расширяем ai_tasks.input_data контрактом brain_dump

-- 3. Триггер/функция для публикации события Brain Dump → Workflow
-- При вставке/update CRM задачи с dispatch_to_workflow=true и pending_dispatch
-- уведомляет через pg_notify (слушает воркер) и создает запись в ai_tasks через backend.

create or replace function public.notify_brain_dump_dispatch()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  payload jsonb;
begin
  if (new.dispatch_to_workflow = true and new.workflow_status = 'pending_dispatch' and new.source = 'ai_brain_dump') then
    payload := jsonb_build_object(
      'event', 'TaskCreatedFromBrainDump',
      'organization_id', new.organization_id,
      'crm_task_id', new.id,
      'project_id', new.project_id,
      'title', new.title,
      'target_role', new.target_role,
      'priority', new.priority,
      'source', new.source
    );
    perform pg_notify('brain_dump_dispatch', payload::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_brain_dump_dispatch on public.tasks;
create trigger trg_notify_brain_dump_dispatch
  after insert or update of source, workflow_status, dispatch_to_workflow, target_role on public.tasks
  for each row execute function public.notify_brain_dump_dispatch();

-- 4. Помогающая RPC для атомарного диспетча: CRM task → ai_tasks (вызывается backend)
create or replace function public.dispatch_brain_dump_to_workflow(
  p_organization_id uuid,
  p_crm_task_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  crm_row public.tasks%rowtype;
  wf_task_id uuid;
  proj uuid;
begin
  select * into crm_row from public.tasks
   where id = p_crm_task_id and organization_id = p_organization_id
   for update;
  if not found then
    raise exception 'CRM task not found';
  end if;
  if crm_row.workflow_status = 'dispatched' and crm_row.ai_workflow_task_id is not null then
    return crm_row.ai_workflow_task_id;
  end if;

  proj := crm_row.project_id;

  insert into public.ai_tasks(
    organization_id, project_id, title, description, source, source_entity_type, source_entity_id,
    status, priority, input_data, created_by
  ) values (
    p_organization_id,
    proj,
    crm_row.title,
    coalesce(crm_row.description,''),
    'ai_brain_dump',
    'crm_task',
    crm_row.id::text,
    'queued',
    case crm_row.priority when 'high' then 'high' when 'low' then 'low' else 'medium' end,
    jsonb_build_object(
      'brain_dump', true,
      'target_role', crm_row.target_role,
      'crm_task_id', crm_row.id,
      'source', 'ai_brain_dump',
      'dispatch_to_workflow', true,
      'auto_assign', true
    ),
    coalesce(p_actor_id, crm_row.created_by)
  ) returning id into wf_task_id;

  update public.tasks set workflow_status='dispatched', ai_workflow_task_id=wf_task_id, updated_at=now()
   where id = p_crm_task_id and organization_id=p_organization_id;

  insert into public.task_events(organization_id, task_id, project_id, event_type, message, metadata)
  values (p_organization_id, wf_task_id, proj, 'brain_dump_dispatched',
          'Выгрузка мыслей: задача принята C-level диспетчером (Orbit Commander).',
          jsonb_build_object('crm_task_id', crm_row.id, 'target_role', crm_row.target_role));

  return wf_task_id;
end;
$$;

revoke all on function public.notify_brain_dump_dispatch() from public, anon, authenticated;
grant execute on function public.dispatch_brain_dump_to_workflow(uuid, uuid, uuid) to service_role;
revoke execute on function public.dispatch_brain_dump_to_workflow(uuid, uuid, uuid) from public, anon, authenticated;
