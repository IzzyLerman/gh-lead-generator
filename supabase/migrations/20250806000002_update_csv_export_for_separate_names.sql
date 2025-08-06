-- Update export_contacts_csv function to include separate name columns
-- This provides both the combined name and separate first/middle/last names

CREATE OR REPLACE FUNCTION private.export_contacts_csv()
RETURNS TEXT AS $$
DECLARE
    csv_output TEXT;
BEGIN
    SELECT string_agg(csv_row, E'\n') INTO csv_output
    FROM (
        SELECT 'company_name,contact_name,first_name,middle_name,last_name,title,email,phone,email_subject,email_body,text_message' AS csv_row
        UNION ALL
        SELECT 
            '"' || REPLACE(COALESCE(c.name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.first_name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.middle_name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.last_name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.title, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.email, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.phone, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.email_subject, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.email_body, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.text_message, ''), '"', '""') || '"' AS csv_row
        FROM public.contacts ct
        JOIN public.companies c ON ct.company_id = c.id
    ) all_data;
    
    RETURN COALESCE(csv_output, '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;