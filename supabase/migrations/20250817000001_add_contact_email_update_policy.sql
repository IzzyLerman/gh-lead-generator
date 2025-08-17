-- Add email column to the existing column-level security policy
-- First revoke table-level update privilege (if it exists)
REVOKE UPDATE ON public.contacts FROM authenticated;

-- Grant update privilege for status column, message fields, and email
GRANT UPDATE (status, email, email_subject, email_body, text_message) ON public.contacts TO authenticated;

-- The existing RLS policy "allow_authenticated_update_contact_status" will cover the new email column