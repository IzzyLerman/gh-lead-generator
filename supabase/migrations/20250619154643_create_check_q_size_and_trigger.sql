
-- Check q size, if its >=5 then trigger the worker

CREATE OR REPLACE FUNCTION private.check_queue_size_and_trigger()
RETURNS trigger AS $$
DECLARE
  queue_size INTEGER;
  worker_url TEXT;
  queue_max INTEGER = 5;
  worker_timeout_ms INTEGER = 5000;
  supabase_service_role_key TEXT;
  auth_token TEXT;
BEGIN

  SELECT count(*) INTO queue_size 
  FROM pgmq."q_image-processing";

  insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] queue size: ' || queue_size);
  
  IF queue_size >= queue_max THEN
    worker_url := (select decrypted_secret from vault.decrypted_secrets where name = 'worker_url');
    supabase_service_role_key := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_service_role_key');

    if worker_url IS NULL THEN
      insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] worker_url is NULL');
    END IF;

    if supabase_service_role_key IS NULL THEN
      insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] supabase_service_role_key is NULL');
    END IF;

    auth_token := 'Bearer ' || supabase_service_role_key;

    insert into public.debug_logs (message) VALUES (worker_url || ' ' || auth_token);

    
    -- Trigger worker
    IF worker_url IS NOT NULL THEN
      PERFORM net.http_post(
        url:=worker_url,
        headers:= jsonb_build_object(
        'Content-Type','application/json',
        'Authorization', auth_token
      ),
        timeout_milliseconds:=worker_timeout_ms
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = private;
;

CREATE TRIGGER "queue_threshhold" 
  AFTER INSERT ON "pgmq"."q_image-processing"
  FOR EACH ROW 
  EXECUTE FUNCTION private.check_queue_size_and_trigger();
