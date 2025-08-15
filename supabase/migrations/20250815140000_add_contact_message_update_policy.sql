-- Use column-level security to allow authenticated users to update message fields
-- First revoke table-level update privilege (if it exists)
REVOKE UPDATE ON public.contacts FROM authenticated;

-- Grant update privilege for status column (existing) and message fields
GRANT UPDATE (status, email_subject, email_body, text_message) ON public.contacts TO authenticated;

-- The RLS policy for contact updates already exists, so no need to create a new one
-- The existing policy "allow_authenticated_update_contact_status" will cover these new columns
