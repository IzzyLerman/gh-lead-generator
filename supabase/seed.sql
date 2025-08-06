-- Seed data for auth users, companies and vehicle-photos tables

-- Create a test user for local development
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, 
  email_confirmed_at, recovery_sent_at, last_sign_in_at, 
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, 
  confirmation_token, email_change, email_change_token_new, recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'izzylerman14@gmail.com',
  crypt('password123', gen_salt('bf')),
  current_timestamp,
  current_timestamp,
  current_timestamp,
  '{"provider":"email","providers":["email"]}',
  '{}',
  current_timestamp,
  current_timestamp,
  '', '', '', ''
);

-- Create corresponding identity entry (required for newer Supabase versions)
INSERT INTO auth.identities (
  id, provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) (
  SELECT 
    gen_random_uuid(),
    u.id,
    u.id,
    format('{"sub":"%s","email":"%s"}', u.id::text, u.email)::jsonb,
    'email',
    current_timestamp,
    current_timestamp,
    current_timestamp
  FROM auth.users u
  WHERE u.email = 'izzylerman14@gmail.com'
);

-- Seed data for companies and vehicle-photos tables

-- Insert sample company data
INSERT INTO public.companies (
  name,
  email,
  phone,
  industry,
  city,
  state,
  status
) VALUES
  (
    'ABC Plumbing Services',
    ARRAY['contact@abcplumbing.com', 'info@abcplumbing.com'],
    ARRAY['+1-555-123-4567', '+1-555-123-4568'],
    ARRAY['Plumbing', 'Home Services'],
    'Denver',
    'Colorado',
    'active'
  ),
  (
    'Elite Electrical Co',
    ARRAY['jobs@eliteelectric.com'],
    ARRAY['+1-555-234-5678'],
    ARRAY['Electrical', 'Construction'],
    'Austin',
    'Texas',
    'active'
  ),
  (
    'Metro HVAC Solutions',
    ARRAY['service@metrohvac.com', 'emergency@metrohvac.com'],
    ARRAY['+1-555-345-6789', '+1-555-345-6790'],
    ARRAY['HVAC', 'Climate Control'],
    'Phoenix',
    'Arizona',
    'active'
  ),
  (
    'Sunshine Landscaping',
    ARRAY['hello@sunshinelandscape.com'],
    ARRAY['+1-555-456-7890'],
    ARRAY['Landscaping', 'Lawn Care'],
    'Miami',
    'Florida',
    'active'
  ),
  (
    'ProClean Janitorial',
    ARRAY['admin@procleanservices.com'],
    ARRAY['+1-555-567-8901'],
    ARRAY['Cleaning Services', 'Commercial'],
    'Seattle',
    'Washington',
    'active'
  );

-- Insert sample contacts data (linking to companies) with ZoomInfo IDs for testing
INSERT INTO public.contacts (
  name,
  title,
  email,
  phone,
  company_id,
  zoominfo_id,
  status
) VALUES
  -- ABC Plumbing Services contacts
  ('John Smith', 'Owner', 'john@abcplumbing.com', '+1-555-123-4567', (SELECT id FROM public.companies WHERE name = 'ABC Plumbing Services'), 12345, 'generating_message'),
  ('Sarah Johnson', 'Office Manager', 'sarah@abcplumbing.com', '+1-555-123-4569', (SELECT id FROM public.companies WHERE name = 'ABC Plumbing Services'), 12346, 'processed'),
  
  -- Elite Electrical Co contacts
  ('Mike Rodriguez', 'Lead Electrician', 'mike@eliteelectric.com', '+1-555-234-5679', (SELECT id FROM public.companies WHERE name = 'Elite Electrical Co'), 54321, 'generating_message'),
  
  -- Metro HVAC Solutions contacts
  ('David Chen', 'Service Manager', 'david@metrohvac.com', '+1-555-345-6791', (SELECT id FROM public.companies WHERE name = 'Metro HVAC Solutions'), 11111, 'processed'),
  ('Lisa Thompson', 'Dispatcher', 'lisa@metrohvac.com', '+1-555-345-6792', (SELECT id FROM public.companies WHERE name = 'Metro HVAC Solutions'), 22222, 'processed'),
  ('Robert Wilson', 'Lead Technician', 'robert@metrohvac.com', '+1-555-345-6793', (SELECT id FROM public.companies WHERE name = 'Metro HVAC Solutions'), 33333, 'processed'),
  
  -- Sunshine Landscaping contacts - James Martinez phone only for testing
  ('Maria Garcia', 'Owner', 'maria@sunshinelandscape.com', NULL, (SELECT id FROM public.companies WHERE name = 'Sunshine Landscaping'), 67890, 'generating_message'),
  ('James Martinez', 'Crew Leader', NULL, '+1-555-456-7892', (SELECT id FROM public.companies WHERE name = 'Sunshine Landscaping'), 67891, 'generating_message');
  
  -- ProClean Janitorial - intentionally left with no contacts

-- Insert sample vehicle photos linked to companies for testing
INSERT INTO public."vehicle-photos" (
  name,
  location,
  company_id,
  status,
  submitted_by
) VALUES
  ('abc_plumbing_truck.jpg', 'Denver Downtown Area', (SELECT id FROM public.companies WHERE name = 'ABC Plumbing Services'), 'processed', 'system'),
  ('elite_electrical_van.jpg', 'Austin Tech District', (SELECT id FROM public.companies WHERE name = 'Elite Electrical Co'), 'processed', 'system'),
  ('metro_hvac_service_truck.jpg', 'Phoenix Residential Zone', (SELECT id FROM public.companies WHERE name = 'Metro HVAC Solutions'), 'processed', 'system'),
  ('sunshine_landscaping_trailer.jpg', 'Miami Beach Area', (SELECT id FROM public.companies WHERE name = 'Sunshine Landscaping'), 'processed', 'system'),
  ('proclean_van.jpg', 'Seattle Business District', (SELECT id FROM public.companies WHERE name = 'ProClean Janitorial'), 'processed', 'system');

