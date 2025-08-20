-- Remove existing column-level restrictions for contacts table
REVOKE ALL ON public.contacts FROM authenticated;

-- Grant full CRUD permissions to authenticated users for contacts table
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;

-- Drop existing policies for contacts
DROP POLICY IF EXISTS "allow_authenticated_update_contact_status" ON public.contacts;
DROP POLICY IF EXISTS "allow_authenticated_update_contact_message" ON public.contacts;
DROP POLICY IF EXISTS "allow_authenticated_update_contact_email" ON public.contacts;
DROP POLICY IF EXISTS "allow_authenticated_update_verifalia_column" ON public.contacts;

-- Create comprehensive CRUD policies for contacts
CREATE POLICY "allow_authenticated_read_contacts"
ON public.contacts
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "allow_authenticated_insert_contacts"
ON public.contacts
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "allow_authenticated_update_contacts"
ON public.contacts
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "allow_authenticated_delete_contacts"
ON public.contacts
FOR DELETE
TO authenticated
USING (true);