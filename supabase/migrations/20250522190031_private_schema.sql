CREATE SCHEMA private;

revoke usage on SCHEMA private from anon, authenticated, public;
GRANT USAGE ON SCHEMA private TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO service_role;
