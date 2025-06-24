-- Add anonymous read access to companies table
CREATE POLICY "allow_anonymous_read_companies"
ON public.companies
FOR SELECT
TO authenticated
USING (true);

-- Enable RLS on contacts table (not currently enabled)
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- Add anonymous read access to contacts table
CREATE POLICY "allow_anonymous_read_contacts"
ON public.contacts
FOR SELECT
TO authenticated
USING (true);

-- Add anonymous read access to gh-vehicle-photos bucket
CREATE POLICY "allow_anonymous_read_gh_vehicle_photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'gh-vehicle-photos');
