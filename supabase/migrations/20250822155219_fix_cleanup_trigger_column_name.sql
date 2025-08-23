-- Fix the cleanup trigger function to use correct column name 'name' instead of 'file_path'
CREATE OR REPLACE FUNCTION private.cleanup_vehicle_photos_on_storage_delete()
RETURNS trigger AS $$
BEGIN
  DELETE FROM public."vehicle-photos"
  WHERE name = OLD.name;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = private;