-- Create contact-enrichment queue for companies ready for contact enrichment
SELECT pgmq.create('contact-enrichment');

-- Create trigger function to check contact-enrichment queue size and trigger find-contacts function
CREATE OR REPLACE FUNCTION private.check_contact_queue_size_and_trigger()
RETURNS trigger AS $$
DECLARE
  queue_size INTEGER;
  functions_base_url TEXT;
  find_contacts_url TEXT;
  queue_max INTEGER = 1;
  worker_timeout_ms INTEGER = 5000;
  supabase_service_role_key TEXT;
  auth_token TEXT;
  http_request_id bigint;
  response_status INTEGER;
  response_body TEXT;
  response_headers jsonb;
BEGIN

  SELECT count(*) INTO queue_size 
  FROM pgmq."q_contact-enrichment";

  insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] queue size: ' || queue_size);
  
  IF queue_size >= queue_max THEN
    -- Get base functions URL (e.g., http://127.0.0.1:54321/functions/v1)
    functions_base_url := (select decrypted_secret from vault.decrypted_secrets where name = 'worker_url');
    supabase_service_role_key := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_service_role_key');

    -- Build find-contacts URL
    IF functions_base_url IS NOT NULL THEN
      find_contacts_url := functions_base_url || '/find-contacts';
    END IF;

    if find_contacts_url IS NULL THEN
      insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] find_contacts_url is NULL');
    END IF;

    if supabase_service_role_key IS NULL THEN
      insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] supabase_service_role_key is NULL');
    END IF;

    auth_token := 'Bearer ' || supabase_service_role_key;

    
    -- Trigger find-contacts function
    IF find_contacts_url IS NOT NULL THEN
      insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] Making HTTP POST to: ' || find_contacts_url);
      
      BEGIN
        -- Make HTTP request and get the request ID
        SELECT net.http_post(
          url:=find_contacts_url,
          headers:= jsonb_build_object(
          'Content-Type','application/json',
          'Authorization', auth_token
        ),
          timeout_milliseconds:=worker_timeout_ms
        ) INTO http_request_id;
        
        insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] HTTP request submitted, ID: ' || http_request_id);
        
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
            insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] No response found for request ID: ' || http_request_id);
            
            -- Let's see what's in the response table
            insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] Checking all responses in table...');
            
            -- Log recent responses to debug
            FOR response_status, response_body IN 
              SELECT status_code, content 
              FROM net._http_response 
              ORDER BY created DESC 
              LIMIT 3
            LOOP
              insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] Recent response - Status: ' || COALESCE(response_status::text, 'NULL') || ', Body: ' || COALESCE(response_body, 'NULL'));
            END LOOP;
            
          END IF;
          
        EXCEPTION WHEN OTHERS THEN
          insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] Error querying _http_response table: ' || SQLERRM);
        END;
        
        insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] Response Status: ' || COALESCE(response_status::text, 'NULL'));
        insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] Response Body: ' || COALESCE(response_body, 'NULL'));
        insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] Response Headers: ' || COALESCE(response_headers::text, 'NULL'));
        
      EXCEPTION WHEN OTHERS THEN
        insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] HTTP POST ERROR: ' || SQLERRM);
        insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] SQLSTATE: ' || SQLSTATE);
      END;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = private;

-- Create trigger on contact-enrichment queue
CREATE TRIGGER "contact_queue_threshold" 
  AFTER INSERT ON "pgmq"."q_contact-enrichment"
  FOR EACH ROW 
  EXECUTE FUNCTION private.check_contact_queue_size_and_trigger();