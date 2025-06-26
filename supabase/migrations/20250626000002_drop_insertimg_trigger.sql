-- Drop the trigger that automatically inserts vehicle-photos records
-- We now handle this manually in the receive-email function to include submitted_by
DROP TRIGGER IF EXISTS on_new_image ON storage.objects;
DROP FUNCTION IF EXISTS public.insertimg();