-- Fix CSV Export Functions for updated schema
-- Remove primary_email and primary_phone columns that no longer exist

-- Function to export companies to CSV format (updated)
CREATE OR REPLACE FUNCTION private.export_companies_csv()
RETURNS TEXT AS $$
DECLARE
    csv_output TEXT;
BEGIN
    SELECT string_agg(csv_row, E'\n') INTO csv_output
    FROM (
        SELECT 'name,industry,email_list,phone_list,city,state,status,group' AS csv_row
        UNION ALL
        SELECT 
            '"' || REPLACE(COALESCE(name, ''), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(industry, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(email, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(phone, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(city, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(state, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(status, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE("group", ''), '"', '""') || '"' AS csv_row
        FROM public.companies
    ) all_data;
    
    RETURN COALESCE(csv_output, '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;