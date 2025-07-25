
GRANT SELECT, INSERT ON pgmq."q_image-processing" TO service_role;
GRANT SELECT, INSERT ON pgmq."q_contact-enrichment" TO service_role;
GRANT SELECT, INSERT ON pgmq."q_email-generation" TO service_role;

GRANT SELECT, UPDATE ON pgmq."q_image-processing" TO service_role;
GRANT SELECT, UPDATE ON pgmq."q_contact-enrichment" TO service_role;
GRANT SELECT, UPDATE ON pgmq."q_email-generation" TO service_role;

GRANT SELECT, DELETE ON pgmq."q_image-processing" TO service_role;
GRANT SELECT, DELETE ON pgmq."q_contact-enrichment" TO service_role;
GRANT SELECT, DELETE ON pgmq."q_email-generation" TO service_role;

-- Grant EXECUTE permissions on pgmq_public functions to service_role
GRANT EXECUTE ON FUNCTION pgmq_public.send(text, jsonb, integer) TO service_role;
GRANT EXECUTE ON FUNCTION pgmq_public.read(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION pgmq_public.pop(text) TO service_role;
GRANT EXECUTE ON FUNCTION pgmq_public.archive(text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION pgmq_public.delete(text, bigint) TO service_role;
