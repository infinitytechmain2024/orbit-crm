-- ============================================================================
-- REPAIR MIGRATION: Full AI Workflow Infrastructure
-- ============================================================================
-- This single additive migration creates everything missing from the live
-- database to support the AI Workflow pipeline (Render backend + Vercel frontend).
--
-- Phase 1: Foundation (private schema, orgs, helper functions)
-- Phase 2: Calendar tables (calendar_events, reminders)
-- Phase 3: AI Workflow core tables (ai_departments, ai_agents, ai_tasks, etc.)
-- Phase 4: Orbit Commander tables (workflow_runs, workflow_jobs, RBAC, etc.)
-- Phase 5: Brain dump dispatch (tasks columns + RPC)
-- Phase 6: Fix ai_tasks.source check constraint
-- ============================================================================

-- ============================================================================
-- PHASE 1: Foundation
-- ============================================================================

-- 1.1 Private schema
CREATE SCHEMA IF NOT EXISTS "private";
ALTER SCHEMA "private" OWNER TO "postgres";

-- 1.2 set_updated_at() function (used by many triggers)
CREATE OR REPLACE FUNCTION "public"."set_updated_at"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" TO ''
AS $$
begin new.updated_at = now(); return new; end
$$;
ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

-- 1.3 organizations table
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

DO $$ BEGIN
    ALTER TABLE ONLY "public"."organizations"
        ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."organizations"
        ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."organizations"
        ADD CONSTRAINT "organizations_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organizations_member_select"
    ON "public"."organizations" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("id", (SELECT "auth"."uid"() AS "uid")));

-- 1.4 organization_members table
CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."organization_members"
        ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id", "user_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."organization_members"
        ADD CONSTRAINT "organization_members_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."organization_members"
        ADD CONSTRAINT "organization_members_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."organization_members"
        ADD CONSTRAINT "organization_members_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_members_member_select"
    ON "public"."organization_members" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

-- 1.5 private.is_organization_member() function
CREATE OR REPLACE FUNCTION "private"."is_organization_member"(
    "target_organization_id" "uuid",
    "target_user_id" "uuid"
) RETURNS boolean
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
ALTER FUNCTION "private"."is_organization_member"("uuid", "uuid") OWNER TO "postgres";

-- 1.6 organizations trigger
CREATE OR REPLACE TRIGGER "set_organizations_updated_at"
    BEFORE UPDATE ON "public"."organizations"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- ============================================================================
-- PHASE 2: Calendar tables
-- ============================================================================

-- 2.1 calendar_events (simplified FKs to avoid missing deal/lead_client refs)
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

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_events"
        ADD CONSTRAINT "calendar_events_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_events"
        ADD CONSTRAINT "calendar_events_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_events"
        ADD CONSTRAINT "calendar_events_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."calendar_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_events_member_select"
    ON "public"."calendar_events" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

CREATE POLICY "calendar_events_member_insert"
    ON "public"."calendar_events" FOR INSERT TO "authenticated"
    WITH CHECK ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

CREATE POLICY "calendar_events_member_update"
    ON "public"."calendar_events" FOR UPDATE TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")))
    WITH CHECK ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT ALL ON TABLE "public"."calendar_events" TO "authenticated";
GRANT ALL ON TABLE "public"."calendar_events" TO "service_role";

CREATE INDEX IF NOT EXISTS "calendar_events_org_time_idx"
    ON "public"."calendar_events" USING btree ("organization_id", "starts_at");
CREATE INDEX IF NOT EXISTS "calendar_events_created_by_idx"
    ON "public"."calendar_events" USING btree ("created_by");
CREATE INDEX IF NOT EXISTS "calendar_events_reminder_idx"
    ON "public"."calendar_events" USING btree ("reminder_at")
    WHERE (("reminder_at" IS NOT NULL) AND ("reminder_sent_at" IS NULL));

CREATE OR REPLACE TRIGGER "set_calendar_events_updated_at"
    BEFORE UPDATE ON "public"."calendar_events"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 2.2 calendar_reminders
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

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_reminders"
        ADD CONSTRAINT "calendar_reminders_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_reminders"
        ADD CONSTRAINT "calendar_reminders_event_id_channel_key" UNIQUE ("event_id", "channel");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_reminders"
        ADD CONSTRAINT "calendar_reminders_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_reminders"
        ADD CONSTRAINT "calendar_reminders_event_id_fkey"
        FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."calendar_reminders" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_reminders_member_read"
    ON "public"."calendar_reminders" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT ALL ON TABLE "public"."calendar_reminders" TO "service_role";
GRANT SELECT ON TABLE "public"."calendar_reminders" TO "authenticated";

CREATE INDEX IF NOT EXISTS "calendar_reminders_due_idx"
    ON "public"."calendar_reminders" USING btree ("scheduled_for", "id")
    WHERE ("status" = 'queued'::"text");
CREATE INDEX IF NOT EXISTS "calendar_reminders_org_event_idx"
    ON "public"."calendar_reminders" USING btree ("organization_id", "event_id");

-- 2.3 calendar_reminder_deliveries
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

DO $$ BEGIN
    ALTER TABLE "public"."calendar_reminder_deliveries" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
        SEQUENCE NAME "public"."calendar_reminder_deliveries_id_seq"
        START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1
    );
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_reminder_deliveries"
        ADD CONSTRAINT "calendar_reminder_deliveries_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_reminder_deliveries"
        ADD CONSTRAINT "calendar_reminder_deliveries_reminder_id_attempt_number_key" UNIQUE ("reminder_id", "attempt_number");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_reminder_deliveries"
        ADD CONSTRAINT "calendar_reminder_deliveries_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_reminder_deliveries"
        ADD CONSTRAINT "calendar_reminder_deliveries_reminder_id_fkey"
        FOREIGN KEY ("reminder_id") REFERENCES "public"."calendar_reminders"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."calendar_reminder_deliveries"
        ADD CONSTRAINT "calendar_reminder_deliveries_event_id_fkey"
        FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."calendar_reminder_deliveries" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar_reminder_deliveries_member_read"
    ON "public"."calendar_reminder_deliveries" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT ALL ON TABLE "public"."calendar_reminder_deliveries" TO "service_role";
GRANT SELECT ON TABLE "public"."calendar_reminder_deliveries" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."calendar_reminder_deliveries_id_seq" TO "service_role";

CREATE INDEX IF NOT EXISTS "calendar_reminder_deliveries_event_idx"
    ON "public"."calendar_reminder_deliveries" USING btree ("event_id");
CREATE INDEX IF NOT EXISTS "calendar_reminder_deliveries_org_created_idx"
    ON "public"."calendar_reminder_deliveries" USING btree ("organization_id", "created_at" DESC);

-- 2.4 Calendar helper functions
CREATE OR REPLACE FUNCTION "public"."prepare_calendar_event_reminder"()
RETURNS "trigger"
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

CREATE OR REPLACE FUNCTION "public"."process_due_calendar_reminders"("p_limit" integer DEFAULT 100)
RETURNS integer
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

CREATE OR REPLACE FUNCTION "public"."sync_calendar_event_reminder"()
RETURNS "trigger"
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

CREATE OR REPLACE TRIGGER "prepare_calendar_event_reminder"
    BEFORE INSERT OR UPDATE OF "reminder_at", "status", "starts_at"
    ON "public"."calendar_events"
    FOR EACH ROW EXECUTE FUNCTION "public"."prepare_calendar_event_reminder"();

CREATE OR REPLACE TRIGGER "sync_calendar_event_reminder"
    AFTER INSERT OR UPDATE OF "reminder_at", "status", "starts_at"
    ON "public"."calendar_events"
    FOR EACH ROW EXECUTE FUNCTION "public"."sync_calendar_event_reminder"();

-- Add calendar_events to realtime publication
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.calendar_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PHASE 3: AI Workflow Core Tables
-- ============================================================================

-- 3.1 ai_departments
CREATE TABLE IF NOT EXISTS "public"."ai_departments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_departments_name_check" CHECK (("char_length"(TRIM(BOTH FROM "name")) > 0))
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_departments"
        ADD CONSTRAINT "ai_departments_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_departments"
        ADD CONSTRAINT "ai_departments_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."ai_departments" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read AI departments"
    ON "public"."ai_departments" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."ai_departments" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."ai_departments" TO "service_role";

CREATE INDEX IF NOT EXISTS "ai_departments_organization_idx"
    ON "public"."ai_departments" USING btree ("organization_id");

CREATE OR REPLACE TRIGGER "set_ai_departments_updated_at"
    BEFORE UPDATE ON "public"."ai_departments"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 3.2 ai_agents
CREATE TABLE IF NOT EXISTS "public"."ai_agents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "department_id" "uuid",
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "capabilities" "jsonb" DEFAULT '[]'::"jsonb",
    "model_preference" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "is_active" boolean DEFAULT true,
    "system_instruction" "text",
    "allowed_tools" "jsonb" DEFAULT '[]'::"jsonb",
    "access_level" "text" DEFAULT 'standard'::"text",
    "max_concurrent_runs" integer DEFAULT 3,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_agents_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'retired'::"text"])))
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_agents"
        ADD CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_agents"
        ADD CONSTRAINT "ai_agents_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_agents"
        ADD CONSTRAINT "ai_agents_department_id_fkey"
        FOREIGN KEY ("department_id") REFERENCES "public"."ai_departments"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."ai_agents" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read AI agents"
    ON "public"."ai_agents" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."ai_agents" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."ai_agents" TO "service_role";

CREATE INDEX IF NOT EXISTS "ai_agents_department_idx"
    ON "public"."ai_agents" USING btree ("organization_id", "department_id");
CREATE INDEX IF NOT EXISTS "ai_agents_active_status_idx"
    ON "public"."ai_agents" USING btree ("organization_id", "is_active", "status");
CREATE INDEX IF NOT EXISTS "ai_agents_capabilities_idx"
    ON "public"."ai_agents" USING gin ("capabilities");

CREATE OR REPLACE TRIGGER "set_ai_agents_updated_at"
    BEFORE UPDATE ON "public"."ai_agents"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 3.3 ai_model_configs
CREATE TABLE IF NOT EXISTS "public"."ai_model_configs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "model_name" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "capabilities" "jsonb" DEFAULT '[]'::"jsonb",
    "priority" integer DEFAULT 0,
    "is_enabled" boolean DEFAULT true,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_model_configs"
        ADD CONSTRAINT "ai_model_configs_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_model_configs"
        ADD CONSTRAINT "ai_model_configs_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."ai_model_configs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read AI model configs"
    ON "public"."ai_model_configs" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."ai_model_configs" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."ai_model_configs" TO "service_role";

CREATE INDEX IF NOT EXISTS "ai_model_configs_enabled_idx"
    ON "public"."ai_model_configs" USING btree ("organization_id", "priority", "model_name")
    WHERE ("is_enabled" = true);
CREATE INDEX IF NOT EXISTS "ai_model_configs_capabilities_idx"
    ON "public"."ai_model_configs" USING gin ("capabilities");

CREATE OR REPLACE TRIGGER "set_ai_model_configs_updated_at"
    BEFORE UPDATE ON "public"."ai_model_configs"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 3.4 ai_tasks
CREATE TABLE IF NOT EXISTS "public"."ai_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "department_id" "uuid",
    "agent_id" "uuid",
    "parent_task_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "due_at" timestamp with time zone,
    "input_data" "jsonb" DEFAULT '{}'::"jsonb",
    "result" "jsonb",
    "current_model" "text",
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "original_request" "text" DEFAULT ''::"text",
    "source" "text" DEFAULT 'manual'::"text",
    "source_entity_type" "text",
    "source_entity_id" "uuid",
    "risk_level" "text" DEFAULT 'low'::"text",
    "approval_required" boolean DEFAULT false,
    "goal" "text" DEFAULT ''::"text",
    "acceptance_criteria" "jsonb" DEFAULT '[]'::"jsonb",
    "execution_plan" "jsonb" DEFAULT '{}'::"jsonb",
    "assumptions" "jsonb" DEFAULT '[]'::"jsonb",
    "blocker_reason" "text",
    "qa_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "qa_report" "jsonb",
    "attempt_count" integer DEFAULT 0,
    "max_attempts" integer DEFAULT 3,
    "timeout_seconds" integer DEFAULT 900,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "workflow_run_id" "uuid",
    CONSTRAINT "ai_tasks_title_check" CHECK (("char_length"(TRIM(BOTH FROM "title")) > 0 AND "char_length"(TRIM(BOTH FROM "title")) <= 240)),
    CONSTRAINT "ai_tasks_status_check" CHECK (("status" = ANY (ARRAY['planning'::"text", 'queued'::"text", 'in_progress'::"text", 'paused'::"text", 'review'::"text", 'approval_required'::"text", 'done'::"text", 'blocked'::"text", 'revisions_requested'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "ai_tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "ai_tasks_risk_level_check" CHECK (("risk_level" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "ai_tasks_source_check" CHECK (("source" = ANY (ARRAY['text'::"text", 'voice'::"text", 'manual'::"text", 'project'::"text", 'note'::"text", 'client'::"text", 'api'::"text", 'ai_brain_dump'::"text"]))),
    CONSTRAINT "ai_tasks_qa_status_check" CHECK (("qa_status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'passed'::"text", 'failed'::"text", 'not_required'::"text"]))),
    CONSTRAINT "ai_tasks_attempt_count_check" CHECK (("attempt_count" >= 0)),
    CONSTRAINT "ai_tasks_max_attempts_check" CHECK (("max_attempts" >= 1 AND "max_attempts" <= 10)),
    CONSTRAINT "ai_tasks_timeout_seconds_check" CHECK (("timeout_seconds" >= 30 AND "timeout_seconds" <= 86400))
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_tasks"
        ADD CONSTRAINT "ai_tasks_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_tasks"
        ADD CONSTRAINT "ai_tasks_organization_id_id_key" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_tasks"
        ADD CONSTRAINT "ai_tasks_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_tasks"
        ADD CONSTRAINT "ai_tasks_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_tasks"
        ADD CONSTRAINT "ai_tasks_department_id_fkey"
        FOREIGN KEY ("department_id") REFERENCES "public"."ai_departments"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_tasks"
        ADD CONSTRAINT "ai_tasks_agent_id_fkey"
        FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."ai_tasks" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read AI tasks"
    ON "public"."ai_tasks" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."ai_tasks" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."ai_tasks" TO "service_role";

CREATE INDEX IF NOT EXISTS "ai_tasks_project_status_idx"
    ON "public"."ai_tasks" USING btree ("organization_id", "project_id", "status", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_tasks_department_status_idx"
    ON "public"."ai_tasks" USING btree ("organization_id", "department_id", "status", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_tasks_agent_status_idx"
    ON "public"."ai_tasks" USING btree ("organization_id", "agent_id", "status", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_tasks_parent_idx"
    ON "public"."ai_tasks" USING btree ("parent_task_id")
    WHERE ("parent_task_id" IS NOT NULL);

CREATE OR REPLACE TRIGGER "set_ai_tasks_updated_at"
    BEFORE UPDATE ON "public"."ai_tasks"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 3.5 task_events
CREATE TABLE IF NOT EXISTS "public"."task_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "actor_agent_id" "uuid",
    "actor_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."task_events"
        ADD CONSTRAINT "task_events_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."task_events"
        ADD CONSTRAINT "task_events_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."task_events"
        ADD CONSTRAINT "task_events_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."task_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read task events"
    ON "public"."task_events" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."task_events" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."task_events" TO "service_role";

CREATE INDEX IF NOT EXISTS "task_events_timeline_idx"
    ON "public"."task_events" USING btree ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "task_events_task_idx"
    ON "public"."task_events" USING btree ("task_id");

-- 3.6 approval_requests
CREATE TABLE IF NOT EXISTS "public"."approval_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "requested_by_agent_id" "uuid",
    "assigned_to_agent_id" "uuid",
    "action" "text",
    "reason" "text",
    "risk" "text",
    "executor" "text",
    "estimated_cost" numeric,
    "currency" "text",
    "consequences" "text",
    "decision_by" "uuid",
    "decision_comment" "text",
    "decided_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "approval_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text", 'expired'::"text"])))
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."approval_requests"
        ADD CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."approval_requests"
        ADD CONSTRAINT "approval_requests_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."approval_requests"
        ADD CONSTRAINT "approval_requests_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."approval_requests" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read approval requests"
    ON "public"."approval_requests" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."approval_requests" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."approval_requests" TO "service_role";

CREATE UNIQUE INDEX IF NOT EXISTS "approval_requests_one_pending_per_task_idx"
    ON "public"."approval_requests" USING btree ("task_id")
    WHERE ("status" = 'pending'::"text");
CREATE INDEX IF NOT EXISTS "approval_requests_queue_idx"
    ON "public"."approval_requests" USING btree ("organization_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "approval_requests_requester_idx"
    ON "public"."approval_requests" USING btree ("requested_by_agent_id")
    WHERE ("requested_by_agent_id" IS NOT NULL);
CREATE INDEX IF NOT EXISTS "approval_requests_assignee_idx"
    ON "public"."approval_requests" USING btree ("assigned_to_agent_id")
    WHERE ("assigned_to_agent_id" IS NOT NULL);

CREATE OR REPLACE TRIGGER "set_approval_requests_updated_at"
    BEFORE UPDATE ON "public"."approval_requests"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 3.7 artifacts
CREATE TABLE IF NOT EXISTS "public"."artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "agent_id" "uuid",
    "artifact_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "content" "jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."artifacts"
        ADD CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."artifacts"
        ADD CONSTRAINT "artifacts_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."artifacts"
        ADD CONSTRAINT "artifacts_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."artifacts" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read artifacts"
    ON "public"."artifacts" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."artifacts" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."artifacts" TO "service_role";

CREATE INDEX IF NOT EXISTS "artifacts_timeline_idx"
    ON "public"."artifacts" USING btree ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "artifacts_task_idx"
    ON "public"."artifacts" USING btree ("task_id");

-- Add core tables to realtime publication
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_departments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_agents;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_model_configs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ai_tasks;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_events;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.approval_requests;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.artifacts;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- PHASE 4: Orbit Commander Tables
-- ============================================================================

-- 4.1 roles
CREATE TABLE IF NOT EXISTS "public"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "is_system" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."roles"
        ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."roles"
        ADD CONSTRAINT "roles_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."roles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read roles"
    ON "public"."roles" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."roles" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."roles" TO "service_role";

CREATE INDEX IF NOT EXISTS "roles_org_idx"
    ON "public"."roles" USING btree ("organization_id", "code");

CREATE OR REPLACE TRIGGER "set_roles_updated_at"
    BEFORE UPDATE ON "public"."roles"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 4.2 permissions
CREATE TABLE IF NOT EXISTS "public"."permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."permissions"
        ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."permissions"
        ADD CONSTRAINT "permissions_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."permissions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read permissions"
    ON "public"."permissions" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."permissions" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."permissions" TO "service_role";

CREATE INDEX IF NOT EXISTS "permissions_org_idx"
    ON "public"."permissions" USING btree ("organization_id", "code");

-- 4.3 role_permissions
CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "permission_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."role_permissions"
        ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."role_permissions"
        ADD CONSTRAINT "role_permissions_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."role_permissions"
        ADD CONSTRAINT "role_permissions_role_id_fkey"
        FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."role_permissions"
        ADD CONSTRAINT "role_permissions_permission_id_fkey"
        FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read role permissions"
    ON "public"."role_permissions" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."role_permissions" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."role_permissions" TO "service_role";

CREATE INDEX IF NOT EXISTS "role_permissions_org_idx"
    ON "public"."role_permissions" USING btree ("organization_id", "role_id");

-- 4.4 workflows
CREATE TABLE IF NOT EXISTS "public"."workflows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text",
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflows"
        ADD CONSTRAINT "workflows_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflows"
        ADD CONSTRAINT "workflows_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."workflows" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read workflows"
    ON "public"."workflows" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."workflows" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."workflows" TO "service_role";

CREATE OR REPLACE TRIGGER "set_workflows_updated_at"
    BEFORE UPDATE ON "public"."workflows"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 4.5 workflow_runs
CREATE TABLE IF NOT EXISTS "public"."workflow_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "workflow_id" "uuid",
    "root_task_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'planning'::"text" NOT NULL,
    "commander_state" "jsonb" DEFAULT '{}'::"jsonb",
    "progress" smallint DEFAULT 0,
    "current_phase" "text" DEFAULT 'analysis'::"text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workflow_runs_status_check" CHECK (("status" = ANY (ARRAY['planning'::"text", 'queued'::"text", 'running'::"text", 'paused'::"text", 'review'::"text", 'awaiting_approval'::"text", 'completed'::"text", 'blocked'::"text", 'cancelled'::"text", 'failed'::"text"]))),
    CONSTRAINT "workflow_runs_progress_check" CHECK (("progress" >= 0 AND "progress" <= 100))
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_runs"
        ADD CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_runs"
        ADD CONSTRAINT "workflow_runs_organization_id_id_key" UNIQUE ("organization_id", "id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_runs"
        ADD CONSTRAINT "workflow_runs_organization_id_root_task_id_key" UNIQUE ("organization_id", "root_task_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_runs"
        ADD CONSTRAINT "workflow_runs_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_runs"
        ADD CONSTRAINT "workflow_runs_root_task_id_fkey"
        FOREIGN KEY ("root_task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_runs"
        ADD CONSTRAINT "workflow_runs_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."workflow_runs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read workflow runs"
    ON "public"."workflow_runs" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."workflow_runs" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."workflow_runs" TO "service_role";

CREATE INDEX IF NOT EXISTS "workflow_runs_status_idx"
    ON "public"."workflow_runs" USING btree ("organization_id", "status", "updated_at" DESC);

CREATE OR REPLACE TRIGGER "set_workflow_runs_updated_at"
    BEFORE UPDATE ON "public"."workflow_runs"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- Add FK from ai_tasks to workflow_runs (after workflow_runs is created)
DO $$ BEGIN
    ALTER TABLE ONLY "public"."ai_tasks"
        ADD CONSTRAINT "ai_tasks_workflow_run_id_fkey"
        FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ai_tasks_workflow_idx"
    ON "public"."ai_tasks" USING btree ("organization_id", "workflow_run_id", "status", "updated_at" DESC);

-- 4.6 workflow_jobs (the durable job queue)
CREATE TABLE IF NOT EXISTS "public"."workflow_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "workflow_run_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "job_type" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "attempts" integer DEFAULT 0,
    "max_attempts" integer DEFAULT 3,
    "timeout_seconds" integer DEFAULT 900,
    "available_at" timestamp with time zone DEFAULT "now"(),
    "locked_at" timestamp with time zone,
    "locked_by" "text",
    "last_error" "jsonb",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workflow_jobs_job_type_check" CHECK (("job_type" = ANY (ARRAY['plan'::"text", 'execute'::"text", 'qa'::"text", 'finalize'::"text"]))),
    CONSTRAINT "workflow_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'leased'::"text", 'succeeded'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "workflow_jobs_idempotency_key_check" CHECK (("char_length"("idempotency_key") >= 8 AND "char_length"("idempotency_key") <= 200)),
    CONSTRAINT "workflow_jobs_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "workflow_jobs_max_attempts_check" CHECK (("max_attempts" >= 1 AND "max_attempts" <= 10)),
    CONSTRAINT "workflow_jobs_timeout_seconds_check" CHECK (("timeout_seconds" >= 30 AND "timeout_seconds" <= 86400))
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_jobs"
        ADD CONSTRAINT "workflow_jobs_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_jobs"
        ADD CONSTRAINT "workflow_jobs_organization_id_idempotency_key_key" UNIQUE ("organization_id", "idempotency_key");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_jobs"
        ADD CONSTRAINT "workflow_jobs_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_jobs"
        ADD CONSTRAINT "workflow_jobs_workflow_run_id_fkey"
        FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."workflow_jobs"
        ADD CONSTRAINT "workflow_jobs_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."workflow_jobs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read workflow jobs"
    ON "public"."workflow_jobs" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."workflow_jobs" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."workflow_jobs" TO "service_role";

CREATE INDEX IF NOT EXISTS "workflow_jobs_ready_idx"
    ON "public"."workflow_jobs" USING btree ("status", "available_at", "created_at")
    WHERE ("status" = 'queued'::"text");
CREATE INDEX IF NOT EXISTS "workflow_jobs_run_idx"
    ON "public"."workflow_jobs" USING btree ("organization_id", "workflow_run_id", "status");

CREATE OR REPLACE TRIGGER "set_workflow_jobs_updated_at"
    BEFORE UPDATE ON "public"."workflow_jobs"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 4.7 task_dependencies
CREATE TABLE IF NOT EXISTS "public"."task_dependencies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "depends_on_task_id" "uuid" NOT NULL,
    "dependency_type" "text" DEFAULT 'finish_to_start'::"text",
    "is_required" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."task_dependencies"
        ADD CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."task_dependencies"
        ADD CONSTRAINT "task_dependencies_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."task_dependencies"
        ADD CONSTRAINT "task_dependencies_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."task_dependencies"
        ADD CONSTRAINT "task_dependencies_depends_on_task_id_fkey"
        FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."task_dependencies" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read task dependencies"
    ON "public"."task_dependencies" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."task_dependencies" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."task_dependencies" TO "service_role";

CREATE INDEX IF NOT EXISTS "task_dependencies_waiting_idx"
    ON "public"."task_dependencies" USING btree ("organization_id", "task_id", "is_required");
CREATE INDEX IF NOT EXISTS "task_dependencies_upstream_idx"
    ON "public"."task_dependencies" USING btree ("organization_id", "depends_on_task_id");

-- 4.8 agent_capabilities
CREATE TABLE IF NOT EXISTS "public"."agent_capabilities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "capability" "text" NOT NULL,
    "proficiency" smallint DEFAULT 50,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."agent_capabilities"
        ADD CONSTRAINT "agent_capabilities_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."agent_capabilities"
        ADD CONSTRAINT "agent_capabilities_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."agent_capabilities"
        ADD CONSTRAINT "agent_capabilities_agent_id_fkey"
        FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."agent_capabilities" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read agent capabilities"
    ON "public"."agent_capabilities" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."agent_capabilities" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."agent_capabilities" TO "service_role";

CREATE INDEX IF NOT EXISTS "agent_capabilities_lookup_idx"
    ON "public"."agent_capabilities" USING btree ("organization_id", "capability", "agent_id");

-- 4.9 agent_runs
CREATE TABLE IF NOT EXISTS "public"."agent_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "task_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'assigned'::"text" NOT NULL,
    "model_used" "text",
    "input_tokens" integer DEFAULT 0,
    "output_tokens" integer DEFAULT 0,
    "cost_cents" integer DEFAULT 0,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "agent_runs_status_check" CHECK (("status" = ANY (ARRAY['assigned'::"text", 'working'::"text", 'review'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"])))
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."agent_runs"
        ADD CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."agent_runs"
        ADD CONSTRAINT "agent_runs_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."agent_runs"
        ADD CONSTRAINT "agent_runs_agent_id_fkey"
        FOREIGN KEY ("agent_id") REFERENCES "public"."ai_agents"("id") ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."agent_runs"
        ADD CONSTRAINT "agent_runs_task_id_fkey"
        FOREIGN KEY ("task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."agent_runs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read agent runs"
    ON "public"."agent_runs" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."agent_runs" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."agent_runs" TO "service_role";

CREATE INDEX IF NOT EXISTS "agent_runs_task_idx"
    ON "public"."agent_runs" USING btree ("organization_id", "task_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "agent_runs_active_idx"
    ON "public"."agent_runs" USING btree ("organization_id", "agent_id", "status")
    WHERE ("status" = ANY (ARRAY['assigned'::"text", 'working'::"text", 'review'::"text"]));

CREATE OR REPLACE TRIGGER "set_agent_runs_updated_at"
    BEFORE UPDATE ON "public"."agent_runs"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 4.10 agent_messages
CREATE TABLE IF NOT EXISTS "public"."agent_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "workflow_run_id" "uuid" NOT NULL,
    "from_agent_id" "uuid",
    "to_agent_id" "uuid",
    "message_type" "text" DEFAULT 'info'::"text",
    "content" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."agent_messages"
        ADD CONSTRAINT "agent_messages_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."agent_messages"
        ADD CONSTRAINT "agent_messages_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."agent_messages"
        ADD CONSTRAINT "agent_messages_workflow_run_id_fkey"
        FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."agent_messages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read agent messages"
    ON "public"."agent_messages" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."agent_messages" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."agent_messages" TO "service_role";

CREATE INDEX IF NOT EXISTS "agent_messages_timeline_idx"
    ON "public"."agent_messages" USING btree ("organization_id", "workflow_run_id", "created_at" DESC);

-- 4.11 integrations
CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb",
    "is_active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."integrations"
        ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."integrations"
        ADD CONSTRAINT "integrations_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read integrations"
    ON "public"."integrations" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."integrations" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."integrations" TO "service_role";

CREATE OR REPLACE TRIGGER "set_integrations_updated_at"
    BEFORE UPDATE ON "public"."integrations"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 4.12 credentials_metadata
CREATE TABLE IF NOT EXISTS "public"."credentials_metadata" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "integration_id" "uuid" NOT NULL,
    "credential_type" "text" NOT NULL,
    "label" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."credentials_metadata"
        ADD CONSTRAINT "credentials_metadata_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."credentials_metadata"
        ADD CONSTRAINT "credentials_metadata_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."credentials_metadata"
        ADD CONSTRAINT "credentials_metadata_integration_id_fkey"
        FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."credentials_metadata" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read credential metadata"
    ON "public"."credentials_metadata" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."credentials_metadata" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."credentials_metadata" TO "service_role";

CREATE INDEX IF NOT EXISTS "credentials_metadata_integration_idx"
    ON "public"."credentials_metadata" USING btree ("organization_id", "integration_id");

CREATE OR REPLACE TRIGGER "set_credentials_metadata_updated_at"
    BEFORE UPDATE ON "public"."credentials_metadata"
    FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- 4.13 audit_logs
CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "actor_type" "text" NOT NULL,
    "actor_id" "uuid",
    "action" "text" NOT NULL,
    "before_state" "jsonb",
    "after_state" "jsonb",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."audit_logs"
        ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."audit_logs"
        ADD CONSTRAINT "audit_logs_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read audit logs"
    ON "public"."audit_logs" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."audit_logs" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."audit_logs" TO "service_role";
GRANT USAGE ON SEQUENCE "public"."audit_logs_id_seq" TO "service_role";

CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx"
    ON "public"."audit_logs" USING btree ("organization_id", "entity_type", "entity_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx"
    ON "public"."audit_logs" USING btree ("organization_id", "actor_type", "actor_id", "created_at" DESC);

-- 4.14 Drop existing notifications table and recreate with correct schema
DROP TABLE IF EXISTS "public"."notifications" CASCADE;

CREATE TABLE "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "recipient_user_id" "uuid",
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" DEFAULT ''::"text",
    "entity_type" "text",
    "entity_id" "uuid",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."notifications"
        ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."notifications"
        ADD CONSTRAINT "notifications_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read notifications"
    ON "public"."notifications" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid"))
           AND ("recipient_user_id" IS NULL OR "recipient_user_id" = (SELECT "auth"."uid"() AS "uid")));

GRANT SELECT ON TABLE "public"."notifications" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."notifications" TO "service_role";

CREATE INDEX IF NOT EXISTS "notifications_unread_idx"
    ON "public"."notifications" USING btree ("organization_id", "recipient_user_id", "created_at" DESC)
    WHERE ("read_at" IS NULL);

-- Add commander tables to realtime publication
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workflow_runs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.workflow_jobs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.task_dependencies;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4.15 Convenience views
CREATE OR REPLACE VIEW "public"."users" WITH ("security_invoker" = true) AS
  SELECT id, email, raw_user_meta_data->>'full_name' AS full_name,
         raw_user_meta_data->>'avatar_url' AS avatar_url,
         created_at, updated_at
  FROM auth.users;

CREATE OR REPLACE VIEW "public"."agents" WITH ("security_invoker" = true) AS
  SELECT * FROM public.ai_agents;

CREATE OR REPLACE VIEW "public"."task_artifacts" WITH ("security_invoker" = true) AS
  SELECT * FROM public.artifacts;

CREATE OR REPLACE VIEW "public"."approvals" WITH ("security_invoker" = true) AS
  SELECT * FROM public.approval_requests;

-- ============================================================================
-- PHASE 5: claim_workflow_job RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."claim_workflow_job"("p_worker_id" "text")
RETURNS SETOF "public"."workflow_jobs"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  WITH candidate AS (
    SELECT j.id
      FROM public.workflow_jobs j
      JOIN public.workflow_runs r ON r.id = j.workflow_run_id
     WHERE j.status = 'queued'
       AND j.available_at <= now()
       AND r.status NOT IN ('paused', 'cancelled', 'completed', 'failed')
     ORDER BY j.available_at, j.created_at
     LIMIT 1
       FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.workflow_jobs j
     SET status = 'leased',
         attempts = j.attempts + 1,
         locked_at = now(),
         locked_by = p_worker_id
    FROM candidate c
   WHERE j.id = c.id
  RETURNING j.*;
$$;

-- Revoke from broad roles, grant only to service_role
REVOKE ALL ON FUNCTION "public"."claim_workflow_job"("text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."claim_workflow_job"("text") FROM anon;
REVOKE ALL ON FUNCTION "public"."claim_workflow_job"("text") FROM authenticated;
GRANT EXECUTE ON FUNCTION "public"."claim_workflow_job"("text") TO service_role;

-- ============================================================================
-- PHASE 6: Brain Dump Dispatch (tasks columns + RPC)
-- ============================================================================

-- 6.1 Add dispatch columns to CRM tasks table
DO $$ BEGIN
    ALTER TABLE "public"."tasks" ADD COLUMN "source" "text" DEFAULT 'manual'::"text";
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "public"."tasks" ADD COLUMN "workflow_status" "text";
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "public"."tasks" ADD COLUMN "target_role" "text";
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "public"."tasks" ADD COLUMN "dispatch_to_workflow" boolean DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "public"."tasks" ADD COLUMN "ai_workflow_task_id" "uuid";
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- 6.2 Indexes for dispatch
CREATE INDEX IF NOT EXISTS "tasks_workflow_dispatch_idx"
    ON "public"."tasks" USING btree ("dispatch_to_workflow", "workflow_status")
    WHERE ("dispatch_to_workflow" = true);

CREATE INDEX IF NOT EXISTS "tasks_source_idx"
    ON "public"."tasks" USING btree ("source")
    WHERE ("source" IS NOT NULL AND "source" != 'manual'::"text");

CREATE INDEX IF NOT EXISTS "tasks_target_role_idx"
    ON "public"."tasks" USING btree ("target_role")
    WHERE ("target_role" IS NOT NULL);

-- 6.3 FK from tasks to ai_tasks
DO $$ BEGIN
    ALTER TABLE "public"."tasks"
        ADD CONSTRAINT "tasks_ai_workflow_task_id_fkey"
        FOREIGN KEY ("ai_workflow_task_id") REFERENCES "public"."ai_tasks"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 6.4 Brain dump dispatch notification trigger
CREATE OR REPLACE FUNCTION "public"."notify_brain_dump_dispatch"()
RETURNS "trigger"
LANGUAGE "plpgsql" SECURITY DEFINER
SET "search_path" TO ''
AS $$
declare
  v_org_id uuid;
  v_user_id uuid;
begin
  if new.dispatch_to_workflow = true
     and new.workflow_status = 'pending_dispatch'
     and new.source = 'ai_brain_dump' then
    select created_by into v_user_id from public.tasks where id = new.id;
    select om.organization_id into v_org_id
      from public.organization_members om
     where om.user_id = v_user_id
     limit 1;
    perform pg_notify(
      'brain_dump_dispatch',
      json_build_object(
        'task_id', new.id,
        'organization_id', v_org_id,
        'actor_id', v_user_id
      )::text
    );
  end if;
  return new;
end;
$$;

CREATE OR REPLACE TRIGGER "trg_notify_brain_dump_dispatch"
    AFTER INSERT OR UPDATE OF "source", "workflow_status", "dispatch_to_workflow", "target_role"
    ON "public"."tasks"
    FOR EACH ROW EXECUTE FUNCTION "public"."notify_brain_dump_dispatch"();

-- 6.5 RPC: dispatch brain dump to workflow
CREATE OR REPLACE FUNCTION "public"."dispatch_brain_dump_to_workflow"(
    "p_organization_id" "uuid",
    "p_crm_task_id" "uuid",
    "p_actor_id" "uuid"
) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_ai_task_id uuid;
  v_title text;
  v_description text;
  v_priority text;
begin
  SELECT title, description, priority INTO v_title, v_description, v_priority
    FROM public.tasks WHERE id = p_crm_task_id;

  INSERT INTO public.ai_tasks (
    organization_id, title, description, priority, status,
    source, source_entity_type, source_entity_id,
    created_by, original_request, goal
  ) VALUES (
    p_organization_id,
    COALESCE(v_title, 'Untitled task'),
    COALESCE(v_description, ''),
    CASE WHEN v_priority = 'high' THEN 'high'
         WHEN v_priority = 'med' THEN 'medium'
         ELSE 'low' END,
    'queued',
    'ai_brain_dump',
    'crm_task',
    p_crm_task_id,
    p_actor_id,
    COALESCE(v_description, v_title, ''),
    COALESCE(v_title, '')
  )
  RETURNING id INTO v_ai_task_id;

  UPDATE public.tasks
     SET ai_workflow_task_id = v_ai_task_id,
         workflow_status = 'dispatched'
   WHERE id = p_crm_task_id;

  INSERT INTO public.task_events (organization_id, task_id, event_type, payload, actor_user_id)
  VALUES (p_organization_id, v_ai_task_id, 'created', json_build_object('source', 'brain_dump', 'crm_task_id', p_crm_task_id)::jsonb, p_actor_id);

  RETURN v_ai_task_id;
end;
$$;

-- Revoke from broad roles, grant only to service_role
REVOKE ALL ON FUNCTION "public"."dispatch_brain_dump_to_workflow"("uuid", "uuid", "uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."dispatch_brain_dump_to_workflow"("uuid", "uuid", "uuid") FROM anon;
REVOKE ALL ON FUNCTION "public"."dispatch_brain_dump_to_workflow"("uuid", "uuid", "uuid") FROM authenticated;
GRANT EXECUTE ON FUNCTION "public"."dispatch_brain_dump_to_workflow"("uuid", "uuid", "uuid") TO service_role;

-- ============================================================================
-- PHASE 7: Seed default organization + RBAC (idempotent)
-- ============================================================================

-- Seed a default organization if none exists
DO $$
DECLARE
  v_org_id uuid;
  v_admin_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations LIMIT 1) THEN
    SELECT id INTO v_admin_id FROM auth.users LIMIT 1;
    IF v_admin_id IS NOT NULL THEN
      INSERT INTO public.organizations (name, slug, created_by)
      VALUES ('Orbit CRM', 'orbit-crm', v_admin_id)
      ON CONFLICT (slug) DO NOTHING
      RETURNING id INTO v_org_id;

      IF v_org_id IS NOT NULL THEN
        INSERT INTO public.organization_members (organization_id, user_id, role, created_by)
        VALUES (v_org_id, v_admin_id, 'owner', v_admin_id)
        ON CONFLICT DO NOTHING;

        -- Seed RBAC roles
        INSERT INTO public.roles (organization_id, code, name, is_system) VALUES
          (v_org_id, 'owner', 'Owner', true),
          (v_org_id, 'admin', 'Admin', true),
          (v_org_id, 'manager', 'Manager', true),
          (v_org_id, 'accountant', 'Accountant', true),
          (v_org_id, 'member', 'Member', true)
        ON CONFLICT DO NOTHING;

        -- Seed permissions
        INSERT INTO public.permissions (organization_id, code, name) VALUES
          (v_org_id, 'workflow.read', 'Read Workflows'),
          (v_org_id, 'workflow.create', 'Create Workflows'),
          (v_org_id, 'workflow.control', 'Control Workflows'),
          (v_org_id, 'approval.decide', 'Decide Approvals'),
          (v_org_id, 'agents.manage', 'Manage Agents'),
          (v_org_id, 'integrations.manage', 'Manage Integrations'),
          (v_org_id, 'access.manage', 'Manage Access')
        ON CONFLICT DO NOTHING;

        -- Link owner/admin to all permissions
        INSERT INTO public.role_permissions (organization_id, role_id, permission_id)
        SELECT v_org_id, r.id, p.id
          FROM public.roles r
          CROSS JOIN public.permissions p
         WHERE r.organization_id = v_org_id
           AND p.organization_id = v_org_id
           AND r.code IN ('owner', 'admin')
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;
END $$;

-- ============================================================================
-- DONE
-- ============================================================================
