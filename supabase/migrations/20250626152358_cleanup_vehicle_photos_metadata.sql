-- Migration to add cleanup function in private schema
  CREATE OR REPLACE FUNCTION private.cleanup_vehicle_photos_on_storage_delete()
  RETURNS trigger AS $$
  BEGIN
    DELETE FROM "vehicle-photos"
    WHERE file_path = OLD.name;
    RETURN OLD;
  END;
  $$ LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = private;

-- Trigger on storage.objects table
CREATE TRIGGER cleanup_vehicle_photos_trigger
  AFTER DELETE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION private.cleanup_vehicle_photos_on_storage_delete();

