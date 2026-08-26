revoke all privileges on table public.profiles from anon;
revoke all privileges on table public.organizations from anon;
revoke all privileges on table public.organization_members from anon;
revoke all privileges on table public.projects from anon;
revoke all privileges on table public.project_links from anon;
revoke all privileges on table public.tasks from anon;
revoke all privileges on table public.finance_transactions from anon;

revoke all privileges on table public.profiles from authenticated;
revoke all privileges on table public.organizations from authenticated;
revoke all privileges on table public.organization_members from authenticated;
revoke all privileges on table public.projects from authenticated;
revoke all privileges on table public.project_links from authenticated;
revoke all privileges on table public.tasks from authenticated;
revoke all privileges on table public.finance_transactions from authenticated;

grant select, insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.organizations to authenticated;
grant select, insert, update, delete on table public.organization_members to authenticated;
grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.project_links to authenticated;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update, delete on table public.finance_transactions to authenticated;
