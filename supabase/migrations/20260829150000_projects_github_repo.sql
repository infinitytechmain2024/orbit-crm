-- projects: link a CRM project to an auto-provisioned GitHub repository.
-- Populated asynchronously by backend/routers/internal.py's
-- POST /api/internal/projects/provision-repo, triggered by a Supabase
-- Database Webhook on INSERT into public.projects (configured manually in
-- the Supabase dashboard — see docs/SELF_DEVELOPMENT_SETUP_RUNBOOK.md).
ALTER TABLE "public"."projects"
    ADD COLUMN IF NOT EXISTS "github_repo_owner" "text",
    ADD COLUMN IF NOT EXISTS "github_repo_name" "text",
    ADD COLUMN IF NOT EXISTS "github_repo_url" "text",
    ADD COLUMN IF NOT EXISTS "github_repo_status" "text";

DO $$ BEGIN
    ALTER TABLE ONLY "public"."projects"
        ADD CONSTRAINT "projects_github_repo_status_check"
        CHECK (("github_repo_status" IS NULL) OR ("github_repo_status" = ANY (ARRAY['pending'::"text", 'created'::"text", 'failed'::"text"])));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN "public"."projects"."github_repo_owner" IS 'GitHub account/organization that owns the auto-provisioned repository for this project.';
COMMENT ON COLUMN "public"."projects"."github_repo_name" IS 'Repository name auto-provisioned for this project.';
COMMENT ON COLUMN "public"."projects"."github_repo_url" IS 'HTML URL of the auto-provisioned GitHub repository.';
COMMENT ON COLUMN "public"."projects"."github_repo_status" IS 'Provisioning state: pending while the internal webhook creates the repo, created on success, failed on error.';
