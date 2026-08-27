-- saved_searches: store lead search results for later retrieval
CREATE TABLE IF NOT EXISTS "public"."saved_searches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "query_niche" "text" NOT NULL,
    "query_city" "text" NOT NULL,
    "query_country" "text" NOT NULL,
    "query_limit" integer DEFAULT 20,
    "results" "jsonb" DEFAULT '[]'::"jsonb",
    "total_found" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

DO $$ BEGIN
    ALTER TABLE ONLY "public"."saved_searches"
        ADD CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."saved_searches"
        ADD CONSTRAINT "saved_searches_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE ONLY "public"."saved_searches"
        ADD CONSTRAINT "saved_searches_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "public"."saved_searches" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read saved searches"
    ON "public"."saved_searches" FOR SELECT TO "authenticated"
    USING ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

CREATE POLICY "Members can insert saved searches"
    ON "public"."saved_searches" FOR INSERT TO "authenticated"
    WITH CHECK ("private"."is_organization_member"("organization_id", (SELECT "auth"."uid"() AS "uid")));

CREATE POLICY "Members can update their saved searches"
    ON "public"."saved_searches" FOR UPDATE TO "authenticated"
    USING ("user_id" = (SELECT "auth"."uid"() AS "uid"))
    WITH CHECK ("user_id" = (SELECT "auth"."uid"() AS "uid"));

CREATE POLICY "Members can delete their saved searches"
    ON "public"."saved_searches" FOR DELETE TO "authenticated"
    USING ("user_id" = (SELECT "auth"."uid"() AS "uid"));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."saved_searches" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."saved_searches" TO "service_role";

CREATE INDEX IF NOT EXISTS "saved_searches_org_idx"
    ON "public"."saved_searches" USING btree ("organization_id", "created_at" DESC);
