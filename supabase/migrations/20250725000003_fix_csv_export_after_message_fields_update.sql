-- Fix export_contacts_csv function after message field changes
-- The message column was replaced with email_subject, email_body, and text_message
-- This migration updates the function to export these as separate columns

CREATE OR REPLACE FUNCTION private.export_contacts_csv()
RETURNS TEXT AS $$
DECLARE
    csv_output TEXT;
BEGIN
    SELECT string_agg(csv_row, E'\n') INTO csv_output
    FROM (
        SELECT 'company_name,contact_name,title,email,phone,email_subject,email_body,text_message' AS csv_row
        UNION ALL
        SELECT 
            '"' || REPLACE(COALESCE(c.name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ct.name, ''), '"', '""') || '",' ||
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