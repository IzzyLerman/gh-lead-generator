-- Use column-level security to allow authenticated users to update only the status column
-- First revoke table-level update privilege
REVOKE UPDATE ON public.companies FROM authenticated;

-- Then grant update privilege only for the status column
GRANT UPDATE (status) ON public.companies TO authenticated;

-- Add RLS policy to allow authenticated users to update companies (row-level permission)
CREATE POLICY "allow_authenticated_update_company_status"
ON public.companies
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);