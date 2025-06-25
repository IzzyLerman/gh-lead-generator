CREATE SCHEMA private;

revoke usage on SCHEMA private from anon, public;
GRANT USAGE ON SCHEMA private TO service_role, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO service_role, authenticated;
