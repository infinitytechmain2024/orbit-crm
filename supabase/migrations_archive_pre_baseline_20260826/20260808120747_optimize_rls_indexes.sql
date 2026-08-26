create index if not exists organizations_created_by_idx
  on public.organizations(created_by);

create index if not exists organization_members_created_by_idx
  on public.organization_members(created_by);

create index if not exists projects_created_by_idx
  on public.projects(created_by);

create index if not exists project_links_created_by_idx
  on public.project_links(created_by);

create index if not exists project_links_target_project_id_idx
  on public.project_links(target_project_id);

create index if not exists tasks_created_by_idx
  on public.tasks(created_by);

create index if not exists finance_transactions_created_by_idx
  on public.finance_transactions(created_by);

drop policy if exists "Creators can add first owner membership" on public.organization_members;
drop policy if exists "Owners and admins can add members" on public.organization_members;

create policy "Authorized users can add organization members"
  on public.organization_members
  for insert
  to authenticated
  with check (
    (
      user_id = (select auth.uid())
      and created_by = (select auth.uid())
      and role = 'owner'
      and not private.organization_has_members(organization_id)
      and exists (
        select 1
        from public.organizations as org
        where org.id = organization_id
          and org.created_by = (select auth.uid())
      )
    )
    or private.user_organization_role(organization_id, (select auth.uid())) in ('owner', 'admin')
  );;
