-- Enable pgcrypto extension for HMAC functions needed for JWT generation

CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- Grant usage on pgcrypto functions to service roles
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions TO service_role, postgres;
GRANT USAGE ON SCHEMA extensions TO service_role, postgres;