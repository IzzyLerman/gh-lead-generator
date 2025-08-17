-- Add verifalia_email_valid column to the existing column-level security policy
-- First revoke table-level update privilege (if it exists)
REVOKE UPDATE ON public.contacts FROM authenticated;

-- Grant update privilege for status column, message fields, email, and verifalia_email_valid
GRANT UPDATE (status, email, email_subject, email_body, text_message, verifalia_email_valid) ON public.contacts TO authenticated;

-- The existing RLS policy will cover the new verifalia_email_valid column