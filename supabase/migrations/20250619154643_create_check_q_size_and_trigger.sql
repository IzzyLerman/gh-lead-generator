
-- Check q size, if its >=5 then trigger the worker

CREATE OR REPLACE FUNCTION private.check_queue_size_and_trigger()
RETURNS trigger AS $$
DECLARE
  queue_size INTEGER;
  worker_url TEXT;
  queue_max INTEGER = 1;
  worker_timeout_ms INTEGER = 5000;
  supabase_anon_key TEXT;
  auth_token TEXT;
  http_request_id bigint;
  response_status INTEGER;
  response_body TEXT;
  response_headers jsonb;
BEGIN

  SELECT count(*) INTO queue_size 
  FROM pgmq."q_image-processing";

  insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] queue size: ' || queue_size);
  
  IF queue_size >= queue_max THEN
    worker_url := (select decrypted_secret from vault.decrypted_secrets where name = 'worker_url');
    supabase_anon_key := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_anon_key');

    if worker_url IS NULL THEN
      insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] worker_url is NULL');
    END IF;

    if supabase_anon_key IS NULL THEN
      insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] supabase_anon_key is NULL');
    END IF;

    auth_token := 'Bearer ' || supabase_anon_key;

    
    -- Trigger worker
    IF worker_url IS NOT NULL THEN
      insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] Making HTTP POST to: ' || worker_url);
      
      BEGIN
        -- Make HTTP request and get the request ID
        SELECT net.http_post(
          url:=worker_url,
          headers:= jsonb_build_object(
          'Content-Type','application/json',
          'Authorization', auth_token
        ),
          timeout_milliseconds:=worker_timeout_ms
        ) INTO http_request_id;
        
        insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] HTTP request submitted, ID: ' || http_request_id);
        
        -- Wait for the request to complete (pg_net is async)
        PERFORM pg_sleep(3);
        
        -- Get the response from net._http_response table (note the underscore)
        BEGIN
          SELECT status_code, content, headers, timed_out, error_msg
          INTO response_status, response_body, response_headers
          FROM net._http_response 
          WHERE id = http_request_id;
          
          -- Check if we found a response
          IF NOT FOUND THEN
            insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] No response found for request ID: ' || http_request_id);
            
            -- Let's see what's in the response table
            insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] Checking all responses in table...');
            
            -- Log recent responses to debug
            FOR response_status, response_body IN 
              SELECT status_code, content 
              FROM net._http_response 
              ORDER BY created DESC 
              LIMIT 3
            LOOP
              insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] Recent response - Status: ' || COALESCE(response_status::text, 'NULL') || ', Body: ' || COALESCE(response_body, 'NULL'));
            END LOOP;
            
          END IF;
          
        EXCEPTION WHEN OTHERS THEN
          insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] Error querying _http_response table: ' || SQLERRM);
        END;
        
        insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] Response Status: ' || COALESCE(response_status::text, 'NULL'));
        insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] Response Body: ' || COALESCE(response_body, 'NULL'));
        insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] Response Headers: ' || COALESCE(response_headers::text, 'NULL'));
        
      EXCEPTION WHEN OTHERS THEN
        insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] HTTP POST ERROR: ' || SQLERRM);
        insert into public.debug_logs (message) VALUES ('[check_queue_size_and_trigger()] SQLSTATE: ' || SQLSTATE);
      END;
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
