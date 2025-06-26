-- Add GPS coordinates field to vehicle-photos table
ALTER TABLE public."vehicle-photos" 
ADD COLUMN gps TEXT;

-- Add comment to clarify field usage
COMMENT ON COLUMN public."vehicle-photos".gps IS 'GPS coordinates in "lat,lon" format from EXIF data';
COMMENT ON COLUMN public."vehicle-photos".location IS 'Human-readable street address from reverse geocoding';