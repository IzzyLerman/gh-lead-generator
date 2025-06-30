-- Create test_state table for atomic LLM mock counter
-- This table provides guaranteed unique sequential IDs for test mocking

CREATE TABLE test_state (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS with restrictive policy
-- Service role bypasses RLS, so this prevents unauthorized access
ALTER TABLE test_state ENABLE ROW LEVEL SECURITY;

-- Deny all access to public - only service role can access
CREATE POLICY "Deny all access to test_state" ON test_state 
  FOR ALL TO PUBLIC 
  USING (false);

-- Add comment explaining purpose
COMMENT ON TABLE test_state IS 'Atomic counter table for test mocking - provides guaranteed unique sequential IDs';
COMMENT ON COLUMN test_state.id IS 'Auto-incrementing ID used as atomic counter for mock data selection';
COMMENT ON COLUMN test_state.created_at IS 'Timestamp of when the counter was incremented';