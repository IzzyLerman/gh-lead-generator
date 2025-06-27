-- Update CSV Export Functions to include submitted_by and picture_location from vehicle-photos

-- Function to export companies to CSV format with photo metadata
CREATE OR REPLACE FUNCTION private.export_companies_csv()
RETURNS TEXT AS $$
DECLARE
    csv_output TEXT;
BEGIN
    SELECT string_agg(csv_row, E'\n') INTO csv_output
    FROM (
        SELECT 'name,industry,email_list,phone_list,city,state,status,group,submitted_by,picture_location' AS csv_row
        UNION ALL
        SELECT 
            '"' || REPLACE(COALESCE(c.name, ''), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(c.industry, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(c.email, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(c.phone, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.city, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.state, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.status, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c."group", ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(vp.submitted_by, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(vp.location, ''), '"', '""') || '"' AS csv_row
        FROM public.companies c
        LEFT JOIN public."vehicle-photos" vp ON c.id = vp.company_id
    ) all_data;
    
    RETURN COALESCE(csv_output, '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;