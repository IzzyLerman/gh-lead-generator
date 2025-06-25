-- CSV Export Functions for Companies and Contacts
-- These functions generate CSV-formatted text for data export

-- Function to export companies to CSV format
CREATE OR REPLACE FUNCTION private.export_companies_csv()
RETURNS TEXT AS $$
DECLARE
    csv_output TEXT;
BEGIN
    SELECT string_agg(csv_row, E'\n') INTO csv_output
    FROM (
        SELECT 'name,industry,primary_email,email_list,primary_phone,phone_list,city,state,status,group' AS csv_row
        UNION ALL
        SELECT 
            '"' || REPLACE(COALESCE(name, ''), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(industry, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(primary_email, ''), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(email, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(primary_phone, ''), '"', '""') || '",' ||
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

-- Function to export contacts with company information to CSV format  
CREATE OR REPLACE FUNCTION private.export_contacts_csv()
RETURNS TEXT AS $$
DECLARE
    csv_output TEXT;
BEGIN
    SELECT string_agg(csv_row, E'\n') INTO csv_output
    FROM (
        SELECT 'company_name,contact_name,title,email,phone,message' AS csv_row
        UNION ALL
        SELECT 
            '"' || REPLACE(COALESCE(c.name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.title, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.email, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.phone, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.message, ''), '"', '""') || '"' AS csv_row
        FROM public.contacts ct
        JOIN public.companies c ON ct.company_id = c.id
    ) all_data;
    
    RETURN COALESCE(csv_output, '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION private.export_companies_csv() TO authenticated;
GRANT EXECUTE ON FUNCTION private.export_contacts_csv() TO authenticated;