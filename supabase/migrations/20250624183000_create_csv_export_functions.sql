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
            quote_literal(name) || ',' ||
            quote_literal(array_to_string(industry, ';')) || ',' ||
            quote_literal(COALESCE(primary_email, '')) || ',' ||
            quote_literal(array_to_string(email, ';')) || ',' ||
            quote_literal(COALESCE(primary_phone, '')) || ',' ||
            quote_literal(array_to_string(phone, ';')) || ',' ||
            quote_literal(COALESCE(city, '')) || ',' ||
            quote_literal(COALESCE(state, '')) || ',' ||
            quote_literal(COALESCE(status, '')) || ',' ||
            quote_literal(COALESCE("group", '')) AS csv_row
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
            quote_literal(c.name) || ',' ||
            quote_literal(COALESCE(ct.name, '')) || ',' ||
            quote_literal(COALESCE(ct.title, '')) || ',' ||
            quote_literal(COALESCE(ct.email, '')) || ',' ||
            quote_literal(COALESCE(ct.phone, '')) || ',' ||
            quote_literal(COALESCE(ct.message, '')) AS csv_row
        FROM public.contacts ct
        JOIN public.companies c ON ct.company_id = c.id
    ) all_data;
    
    RETURN COALESCE(csv_output, '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION private.export_companies_csv() TO authenticated;
GRANT EXECUTE ON FUNCTION private.export_contacts_csv() TO authenticated;