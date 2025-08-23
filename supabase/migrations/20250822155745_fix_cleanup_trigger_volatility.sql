-- Fix the cleanup trigger function volatility - DELETE operations require VOLATILE
CREATE OR REPLACE FUNCTION private.cleanup_vehicle_photos_on_storage_delete()
RETURNS trigger AS $$
BEGIN
  DELETE FROM public."vehicle-photos"
  WHERE name = OLD.name;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = private;