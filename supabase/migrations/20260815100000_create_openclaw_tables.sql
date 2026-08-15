-- OpenClaw tasks and subtasks tables for CRM integration

CREATE TABLE IF NOT EXISTS openclaw_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'error', 'cancelled')),
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS openclaw_subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES openclaw_tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error')),
    result TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_openclaw_tasks_status ON openclaw_tasks(status);
CREATE INDEX IF NOT EXISTS idx_openclaw_tasks_org ON openclaw_tasks(organization_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_tasks_created ON openclaw_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openclaw_subtasks_task ON openclaw_subtasks(task_id);

-- Enable RLS
ALTER TABLE openclaw_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_subtasks ENABLE ROW LEVEL SECURITY;

-- Policies for openclaw_tasks
CREATE POLICY "Service role can manage all openclaw tasks"
    ON openclaw_tasks FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can view openclaw tasks"
    ON openclaw_tasks FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert openclaw tasks"
    ON openclaw_tasks FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update openclaw tasks"
    ON openclaw_tasks FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Policies for openclaw_subtasks
CREATE POLICY "Service role can manage all openclaw subtasks"
    ON openclaw_subtasks FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can view openclaw subtasks"
    ON openclaw_subtasks FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert openclaw subtasks"
    ON openclaw_subtasks FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update openclaw subtasks"
    ON openclaw_subtasks FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Grant access to API roles
GRANT SELECT, INSERT, UPDATE ON openclaw_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE ON openclaw_subtasks TO authenticated;
GRANT ALL ON openclaw_tasks TO service_role;
GRANT ALL ON openclaw_subtasks TO service_role;
