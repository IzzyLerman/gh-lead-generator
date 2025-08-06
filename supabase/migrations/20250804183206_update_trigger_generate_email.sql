-- Create function to trigger email generation when messages are enqueued
CREATE OR REPLACE FUNCTION private.trigger_email_generation()
RETURNS trigger AS $$
DECLARE
  queue_size INTEGER;
  base_url TEXT;
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
  FROM pgmq."q_email-generation";

  insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] queue size: ' || queue_size);
  
  IF queue_size >= queue_max THEN
    base_url := (select decrypted_secret from vault.decrypted_secrets where name ='worker_url');
    supabase_service_role_key := (select decrypted_secret from vault.decrypted_secrets where name = 'supabase_service_role_key');

    if base_url IS NULL THEN
      insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] generate_message_url is NULL');
    END IF;

    if supabase_service_role_key IS NULL THEN
      insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] supabase_service_role_key is NULL');
    END IF;

    auth_token := 'Bearer ' || supabase_service_role_key;

    
    -- Trigger generate-message function
    IF base_url IS NOT NULL THEN
      insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] Making HTTP POST to: ' || base_url);
      
      BEGIN
        -- Make HTTP request and get the request ID
        SELECT net.http_post(
          url:=base_url || '/generate-message',
          headers:= jsonb_build_object(
          'Content-Type','application/json',
          'Authorization', auth_token
        ),
          timeout_milliseconds:=worker_timeout_ms
        ) INTO http_request_id;
        
        insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] HTTP request submitted, ID: ' || http_request_id);
        
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
            insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] No response found for request ID: ' || http_request_id);
            
            -- Let's see what's in the response table
            insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] Checking all responses in table...');
            
            -- Log recent responses to debug
            FOR response_status, response_body IN 
              SELECT status_code, content 
              FROM net._http_response 
              ORDER BY created DESC 
              LIMIT 3
            LOOP
              insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] Recent response - Status: ' || COALESCE(response_status::text, 'NULL') || ', Body: ' || COALESCE(response_body, 'NULL'));
            END LOOP;
            
          END IF;
          
        EXCEPTION WHEN OTHERS THEN
          insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] Error querying _http_response table: ' || SQLERRM);
        END;
        
        insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] Response Status: ' || COALESCE(response_status::text, 'NULL'));
        insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] Response Body: ' || COALESCE(response_body, 'NULL'));
        insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] Response Headers: ' || COALESCE(response_headers::text, 'NULL'));
        
      EXCEPTION WHEN OTHERS THEN
        insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] HTTP POST ERROR: ' || SQLERRM);
        insert into public.debug_logs (message) VALUES ('[trigger_email_generation()] SQLSTATE: ' || SQLSTATE);
      END;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = private;


