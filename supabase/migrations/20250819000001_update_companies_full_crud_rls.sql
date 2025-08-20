-- Remove existing column-level restrictions for companies table
REVOKE ALL ON public.companies FROM authenticated;

-- Grant full CRUD permissions to authenticated users for companies table
GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;

-- Drop existing update policy for companies
DROP POLICY IF EXISTS "allow_authenticated_update_company_status" ON public.companies;

-- Create comprehensive CRUD policies for companies
CREATE POLICY "allow_authenticated_read_companies"
ON public.companies
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "allow_authenticated_insert_companies"
ON public.companies
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "allow_authenticated_update_companies"
ON public.companies
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "allow_authenticated_delete_companies"
ON public.companies
FOR DELETE
TO authenticated
USING (true);