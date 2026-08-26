-- Self-Development tables for OpenClaw Goal Stewardship

CREATE TABLE IF NOT EXISTS openclaw_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID,
    label TEXT NOT NULL,
    description TEXT,
    acceptance_criteria JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'error', 'cancelled')),
    progress JSONB DEFAULT '{"done": 0, "total": 0}'::jsonb,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS openclaw_improvements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID REFERENCES openclaw_goals(id) ON DELETE CASCADE,
    suggestion TEXT NOT NULL,
    impact TEXT,
    file_path TEXT,
    code_before TEXT,
    code_after TEXT,
    status TEXT DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'applied', 'rejected')),
    applied BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    applied_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS openclaw_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID REFERENCES openclaw_goals(id) ON DELETE CASCADE,
    analysis_type TEXT,
    content TEXT,
    findings JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_openclaw_goals_status ON openclaw_goals(status);
CREATE INDEX IF NOT EXISTS idx_openclaw_goals_org ON openclaw_goals(organization_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_goals_created ON openclaw_goals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_openclaw_improvements_goal ON openclaw_improvements(goal_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_improvements_status ON openclaw_improvements(status);
CREATE INDEX IF NOT EXISTS idx_openclaw_analyses_goal ON openclaw_analyses(goal_id);

-- Enable RLS
ALTER TABLE openclaw_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_improvements ENABLE ROW LEVEL SECURITY;
ALTER TABLE openclaw_analyses ENABLE ROW LEVEL SECURITY;

-- Policies for openclaw_goals
CREATE POLICY "Service role can manage all openclaw goals"
    ON openclaw_goals FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can view openclaw goals"
    ON openclaw_goals FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert openclaw goals"
    ON openclaw_goals FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update openclaw goals"
    ON openclaw_goals FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Policies for openclaw_improvements
CREATE POLICY "Service role can manage all openclaw improvements"
    ON openclaw_improvements FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can view openclaw improvements"
    ON openclaw_improvements FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert openclaw improvements"
    ON openclaw_improvements FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "Authenticated users can update openclaw improvements"
    ON openclaw_improvements FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Policies for openclaw_analyses
CREATE POLICY "Service role can manage all openclaw analyses"
    ON openclaw_analyses FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can view openclaw analyses"
    ON openclaw_analyses FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert openclaw analyses"
    ON openclaw_analyses FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Grant access
GRANT SELECT, INSERT, UPDATE ON openclaw_goals TO authenticated;
GRANT SELECT, INSERT, UPDATE ON openclaw_improvements TO authenticated;
GRANT SELECT, INSERT ON openclaw_analyses TO authenticated;
GRANT ALL ON openclaw_goals TO service_role;
GRANT ALL ON openclaw_improvements TO service_role;
GRANT ALL ON openclaw_analyses TO service_role;
