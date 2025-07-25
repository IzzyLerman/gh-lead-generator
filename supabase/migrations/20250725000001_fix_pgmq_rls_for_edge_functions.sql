
DROP POLICY IF EXISTS "block_all" ON "pgmq"."q_image-processing";

CREATE POLICY "allow_service_role_all"
ON "pgmq"."q_image-processing"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "block_public"
ON "pgmq"."q_image-processing"
FOR ALL
TO public
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "block_all" ON "pgmq"."q_contact-enrichment";

CREATE POLICY "allow_service_role_all"
ON "pgmq"."q_contact-enrichment"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "block_public"
ON "pgmq"."q_contact-enrichment"
FOR ALL
TO public
USING (false)
WITH CHECK (false);

DROP POLICY IF EXISTS "block_all" ON "pgmq"."q_email-generation";

CREATE POLICY "allow_service_role_all"
ON "pgmq"."q_email-generation"
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "block_public"
ON "pgmq"."q_email-generation"
FOR ALL
TO public
USING (false)
WITH CHECK (false);
