-- Grant permissions for net schema to allow HTTP requests from database functions

-- Grant usage on net schema to service roles
GRANT USAGE ON SCHEMA net TO service_role, postgres;

-- Grant execute permissions on http_post function
GRANT EXECUTE ON FUNCTION net.http_post TO service_role, postgres;

-- Grant execute on all net functions for completeness
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA net TO service_role, postgres;