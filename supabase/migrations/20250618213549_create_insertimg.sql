CREATE OR REPLACE FUNCTION public.insertimg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog AS $$
begin
  INSERT INTO public."vehicle-photos" (name)
  VALUES (NEW.name);
  RETURN NEW;
END;
$$; 

CREATE TRIGGER on_new_image
AFTER INSERT ON storage.objects
FOR EACH ROW
WHEN (NEW.bucket_id = 'gh-vehicle-photos') 
EXECUTE PROCEDURE public.insertimg();
