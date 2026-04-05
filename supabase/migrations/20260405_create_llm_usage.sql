-- LLM Usage tracking table
-- Run this in Supabase SQL Editor if the table doesn't exist yet

CREATE TABLE IF NOT EXISTS llm_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  problem_id UUID REFERENCES problems(id) ON DELETE SET NULL,
  problem_name TEXT,
  model TEXT NOT NULL DEFAULT 'unknown',
  purpose TEXT NOT NULL DEFAULT 'unknown',
  step_id TEXT,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost_usd NUMERIC(12,6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_id ON llm_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_problem_id ON llm_usage(problem_id);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created_at ON llm_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_usage_model ON llm_usage(model);

-- RLS: service role can insert (from pipeline), authenticated users can read their own
ALTER TABLE llm_usage ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (used by pipeline scripts)
CREATE POLICY "Service role full access" ON llm_usage
  FOR ALL USING (true) WITH CHECK (true);

-- Allow authenticated users to read their own usage
CREATE POLICY "Users can read own usage" ON llm_usage
  FOR SELECT USING (auth.uid() = user_id);

-- Allow admins to read all usage (check via profiles table)
CREATE POLICY "Admins can read all usage" ON llm_usage
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
