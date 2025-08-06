-- Fix seed data to ensure ABC Plumbing Services has both industries for CSV export test
-- The test expects 'Plumbing;Home Services' but the data was processed to only have 'plumbing'

UPDATE public.companies 
SET industry = ARRAY['Plumbing', 'Home Services']
WHERE name = 'ABC Plumbing Services';