-- Add RLS policies to contact-enrichment queue
-- This follows the same pattern as other PGMQ queues (image-processing and email-generation)

-- Enable restrictive RLS on the contact-enrichment queue
ALTER TABLE pgmq."q_contact-enrichment" ENABLE ROW LEVEL SECURITY;

-- Create restrictive policy to block all public access
-- Service role bypasses RLS, so only service role can access the queue
CREATE POLICY "block_all"
ON "pgmq"."q_contact-enrichment"
FOR ALL
TO public
USING (false)
WITH CHECK (false);