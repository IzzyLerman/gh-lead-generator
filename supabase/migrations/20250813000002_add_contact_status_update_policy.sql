-- Use column-level security to allow authenticated users to update only the status column
-- First revoke table-level update privilege
REVOKE UPDATE ON public.contacts FROM authenticated;

-- Then grant update privilege only for the status column
GRANT UPDATE (status) ON public.contacts TO authenticated;

-- Add RLS policy to allow authenticated users to update contacts (row-level permission)
CREATE POLICY "allow_authenticated_update_contact_status"
ON public.contacts
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);