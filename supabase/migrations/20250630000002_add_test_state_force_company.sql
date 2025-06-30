-- Add force_company_index column to public.test_state table
-- This allows tests to force all LLM mocks to return the same company

ALTER TABLE public.test_state 
ADD COLUMN force_company_index INTEGER DEFAULT NULL;

-- Add comment explaining the new column
COMMENT ON COLUMN public.test_state.force_company_index IS 'When set, forces all LLM mocks to use this specific company index instead of the serial ID';

-- Create a helper function to set the forced company index for all future mock calls
CREATE OR REPLACE FUNCTION private.set_test_force_company(company_index INTEGER)
RETURNS void AS $$
BEGIN
    -- Clear any existing force settings
    UPDATE public.test_state SET force_company_index = NULL WHERE force_company_index IS NOT NULL;
    
    -- Insert a new row with the forced company index
    INSERT INTO public.test_state (force_company_index) VALUES (company_index);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;

-- Create a helper function to clear the forced company index
CREATE OR REPLACE FUNCTION private.clear_test_force_company()
RETURNS void AS $$
BEGIN
    UPDATE public.test_state SET force_company_index = NULL WHERE force_company_index IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;

-- Create a helper function to get the current forced company index
CREATE OR REPLACE FUNCTION private.get_test_force_company()
RETURNS INTEGER AS $$
DECLARE
    forced_index INTEGER;
BEGIN
    SELECT force_company_index INTO forced_index
    FROM public.test_state 
    WHERE force_company_index IS NOT NULL
    ORDER BY id DESC
    LIMIT 1;
    
    RETURN forced_index;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;
