-- Transactional smoke test for the core CRM access model.
-- Run against a non-empty database as a database owner. Every row is rolled back.
-- A raised exception means that a required RLS or role guarantee failed.

begin;

insert into public.organizations (id, name, slug, created_by)
select fixture.id, fixture.name, fixture.slug || '-' || substr(gen_random_uuid()::text, 1, 8), actor.id
from auth.users actor
cross join (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'RLS owner test', 'rls-owner-test'),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'RLS admin test', 'rls-admin-test'),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'RLS member test', 'rls-member-test'),
  ('10000000-0000-4000-8000-000000000004'::uuid, 'RLS foreign test', 'rls-foreign-test')
) fixture(id, name, slug)
order by actor.created_at
limit 4;

insert into public.organization_members (organization_id, user_id, role, created_by)
select fixture.organization_id, actor.id, fixture.role::public.organization_role, actor.id
from auth.users actor
cross join (values
  ('10000000-0000-4000-8000-000000000001'::uuid, 'owner'),
  ('10000000-0000-4000-8000-000000000002'::uuid, 'admin'),
  ('10000000-0000-4000-8000-000000000003'::uuid, 'member')
) fixture(organization_id, role)
order by actor.created_at
limit 3;

insert into public.projects (id, organization_id, name, created_by)
select '20000000-0000-4000-8000-000000000004',
       '10000000-0000-4000-8000-000000000004', 'Foreign project', id
from auth.users order by created_at limit 1;

select set_config('request.jwt.claim.sub',
  (select id::text from auth.users order by created_at limit 1), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  actor uuid := auth.uid();
  project_id uuid;
  affected integer;
begin
  if exists (select 1 from public.projects where id = '20000000-0000-4000-8000-000000000004') then
    raise exception 'Cross-organization project isolation failed';
  end if;

  update public.organizations set name = 'owner update passed'
  where id = '10000000-0000-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner update failed'; end if;

  update public.organizations set name = 'admin update passed'
  where id = '10000000-0000-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Admin update failed'; end if;

  update public.organizations set name = 'member update must fail'
  where id = '10000000-0000-4000-8000-000000000003';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Member unexpectedly updated organization'; end if;

  insert into public.projects (organization_id, name, created_by, owner_id)
  values ('10000000-0000-4000-8000-000000000003', 'RLS project', actor, actor)
  returning id into project_id;
  update public.projects set description = 'RLS update passed' where id = project_id;

  insert into public.tasks (organization_id, project_id, title, created_by, author_id)
  values ('10000000-0000-4000-8000-000000000003', project_id, 'RLS task', actor, actor);
  update public.tasks set note = 'RLS task update passed'
  where organization_id = '10000000-0000-4000-8000-000000000003' and title = 'RLS task';

  insert into storage.objects (bucket_id, name, owner_id)
  values ('task-files', '10000000-0000-4000-8000-000000000003/rls-test.txt', actor::text);

  begin
    insert into storage.objects (bucket_id, name, owner_id)
    values ('task-files', '10000000-0000-4000-8000-000000000004/forbidden.txt', actor::text);
    raise exception 'Cross-organization Storage upload unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end $$;

rollback;
