-- Update CSV export functions to match new schema requirements

-- Update export_companies_csv function with new schema
CREATE OR REPLACE FUNCTION private.export_companies_csv()
RETURNS TEXT AS $$
DECLARE
    csv_output TEXT;
BEGIN
    SELECT string_agg(csv_row, E'\n') INTO csv_output
    FROM (
        SELECT 'name,industry,primary_industry,email,phone,city,state,zip_code,website,revenue,sic_codes,naics_codes,id,zoominfo_id,status,created_at,updated_at,submitted_by' AS csv_row
        UNION ALL
        SELECT 
            '"' || REPLACE(COALESCE(c.name, ''), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(c.industry, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.primary_industry, ''), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(c.email, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(c.phone, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.city, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.state, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.zip_code, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.website, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.revenue::text, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.sic_codes, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.naics_codes, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.id::text, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.zoominfo_id::text, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.status, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.created_at::text, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.updated_at::text, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(submitted_by_list, ''), '"', '""') || '"' AS csv_row
        FROM (
            SELECT 
                c.*,
                string_agg(DISTINCT vp.submitted_by, ', ') as submitted_by_list
            FROM public.companies c
            LEFT JOIN public."vehicle-photos" vp ON c.id = vp.company_id
            GROUP BY c.id
        ) c
    ) all_data;
    
    RETURN COALESCE(csv_output, '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;

-- Update export_contacts_csv function with new schema
CREATE OR REPLACE FUNCTION private.export_contacts_csv()
RETURNS TEXT AS $$
DECLARE
    csv_output TEXT;
BEGIN
    SELECT string_agg(csv_row, E'\n') INTO csv_output
    FROM (
        SELECT 'name,company_name,title,email,phone,status,email_subject,email_body,text_message,first_name,middle_name,last_name,id,zoominfo_id' AS csv_row
        UNION ALL
        SELECT 
            '"' || REPLACE(COALESCE(ct.name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(c.name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.title, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.email, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.phone, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.status, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.email_subject, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.email_body, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.text_message, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.first_name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.middle_name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.last_name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.id::text, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.zoominfo_id::text, ''), '"', '""') || '"' AS csv_row
        FROM public.contacts ct
        JOIN public.companies c ON ct.company_id = c.id
    ) all_data;
    
    RETURN COALESCE(csv_output, '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;