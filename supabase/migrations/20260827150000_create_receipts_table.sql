CREATE TABLE IF NOT EXISTS "public"."receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "telegram_chat_id" "text" NOT NULL,
    "photo_url" "text" NOT NULL,
    "raw_ocr_text" "text",
    "amount" "numeric"(12,2) NOT NULL DEFAULT 0,
    "currency" "text" NOT NULL DEFAULT 'UAH',
    "receipt_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "category" "text",
    "description" "text",
    "merchant_name" "text",
    "confidence" "float" NOT NULL DEFAULT 0,
    "status" "text" NOT NULL DEFAULT 'parsed',
    "finance_transaction_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

COMMENT ON TABLE "public"."receipts" IS 'OCR-processed receipts for expense tracking';

COMMENT ON COLUMN "public"."receipts"."user_id" IS 'Auth user who created this receipt';
COMMENT ON COLUMN "public"."receipts"."organization_id" IS 'Required tenant boundary column for business entities';
COMMENT ON COLUMN "public"."receipts"."telegram_chat_id" IS 'Telegram user/chat ID for audit and notifications';
COMMENT ON COLUMN "public"."receipts"."photo_url" IS 'Supabase Storage path to the original receipt photo';
COMMENT ON COLUMN "public"."receipts"."raw_ocr_text" IS 'Full text extracted by OpenAI Vision API';
COMMENT ON COLUMN "public"."receipts"."amount" IS 'Extracted expense amount';
COMMENT ON COLUMN "public"."receipts"."currency" IS 'Currency code (UAH, USD, EUR, etc.)';
COMMENT ON COLUMN "public"."receipts"."receipt_date" IS 'Date of the purchase from the receipt';
COMMENT ON COLUMN "public"."receipts"."category" IS 'Expense category (groceries, transport, dining, utilities, etc.)';
COMMENT ON COLUMN "public"."receipts"."description" IS 'Summary of items / merchant description';
COMMENT ON COLUMN "public"."receipts"."merchant_name" IS 'Extracted merchant/store name';
COMMENT ON COLUMN "public"."receipts"."confidence" IS 'OCR confidence score from OpenAI Vision (0-1)';
COMMENT ON COLUMN "public"."receipts"."status" IS 'Parsed/confirmed/rejected status';
COMMENT ON COLUMN "public"."receipts"."finance_transaction_id" IS 'Link to finance_transactions if already saved';

ALTER TABLE "public"."receipts" OWNER TO "postgres";

-- Enable RLS
ALTER TABLE "public"."receipts" ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own receipts (must be organization member)
CREATE POLICY "Users can read own receipts" ON "public"."receipts" FOR SELECT TO "authenticated" USING (
    "organization_id" = (SELECT "organization_id" FROM "public"."profiles" WHERE "user_id" = (SELECT "auth"."uid"() AS "uid" LIMIT 1))
);

-- Policy: Accountants, managers, admins can insert receipts
CREATE POLICY "Accountants can insert receipts" ON "public"."receipts" FOR INSERT TO "authenticated" WITH CHECK (
    ("private"."user_organization_role"("organization_id", (SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role", 'manager'::"public"."organization_role", 'accountant'::"public"."organization_role"]))
);

-- Policy: Can update own receipts
CREATE POLICY "Users can update own receipts" ON "public"."receipts" FOR UPDATE TO "authenticated" USING (
    "organization_id" = (SELECT "organization_id" FROM "public"."profiles" WHERE "user_id" = (SELECT "auth"."uid"() AS "uid" LIMIT 1))
);

-- Policy: Owners and admins can delete receipts
CREATE POLICY "Owners can delete receipts" ON "public"."receipts" FOR DELETE TO "authenticated" USING (
    ("private"."user_organization_role"("organization_id", (SELECT "auth"."uid"() AS "uid")) = ANY (ARRAY['owner'::"public"."organization_role", 'admin'::"public"."organization_role"]))
);

-- Index for organization + date queries
CREATE INDEX "receipts_organization_date_idx" ON "public"."receipts" USING "btree" ("organization_id", "receipt_date" DESC);

-- Index for user lookup
CREATE INDEX "receipts_user_id_idx" ON "public"."receipts" USING "btree" ("user_id");

-- Trigger for updated_at
CREATE OR REPLACE TRIGGER "set_receipts_updated_at"
BEFORE UPDATE ON "public"."receipts"
FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();

-- Trigger to sync with finance_transactions on status change
CREATE OR REPLACE TRIGGER "sync_receipt_to_finance"
AFTER UPDATE ON "public"."receipts"
FOR EACH ROW EXECUTE FUNCTION "private"."sync_receipt_finance";

GRANT ALL ON TABLE "public"."receipts" TO "service_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "public"."receipts" TO "authenticated";