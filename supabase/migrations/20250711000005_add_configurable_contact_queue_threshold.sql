-- Add configurable threshold for contact-enrichment queue trigger
-- This allows changing the threshold without modifying the trigger function

-- Create a configuration table for queue thresholds
CREATE TABLE IF NOT EXISTS public.queue_config (
    queue_name TEXT PRIMARY KEY,
    threshold INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default configuration for contact-enrichment queue
INSERT INTO public.queue_config (queue_name, threshold) 
VALUES ('contact-enrichment', 1)
ON CONFLICT (queue_name) DO NOTHING;

-- Update the trigger function to use configurable threshold
CREATE OR REPLACE FUNCTION private.check_contact_queue_size_and_trigger()
RETURNS trigger AS $$
DECLARE
  queue_size INTEGER;
  functions_base_url TEXT;
  find_contacts_url TEXT;
  queue_max INTEGER;
  worker_timeout_ms INTEGER = 5000;
  supabase_service_role_key TEXT;
  auth_token TEXT;
  http_request_id bigint;
  response_status INTEGER;
  response_body TEXT;
  response_headers jsonb;
BEGIN

  -- Get configurable threshold from queue_config table
  SELECT threshold INTO queue_max 
  FROM public.queue_config 
  WHERE queue_name = 'contact-enrichment';
  
  -- Default to 1 if not configured
  IF queue_max IS NULL THEN
    queue_max := 1;
  END IF;

  SELECT count(*) INTO queue_size 
  FROM pgmq."q_contact-enrichment";

  insert into public.debug_logs (message) VALUES ('[check_contact_queue_size_and_trigger()] queue size: ' || queue_size || ', threshold: ' || queue_max);
  
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

-- Add RLS to queue_config table to prevent unauthorized access
ALTER TABLE public.queue_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "block_all_queue_config"
ON public.queue_config
FOR ALL
TO public
USING (false)
WITH CHECK (false);

-- Allow authenticated users to read queue configuration
CREATE POLICY "allow_authenticated_read_queue_config"
ON public.queue_config
FOR SELECT
TO authenticated
USING (true);