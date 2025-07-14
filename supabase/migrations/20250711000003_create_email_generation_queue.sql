-- Create email-generation queue for contacts ready for email generation
SELECT pgmq.create('email-generation');

-- Enable restrictive RLS on the queue
ALTER TABLE pgmq."q_email-generation" ENABLE ROW LEVEL SECURITY;

-- Create restrictive policy to block all public access
CREATE POLICY "block_all"
ON "pgmq"."q_email-generation"
FOR ALL
TO public
USING (false)
WITH CHECK (false);