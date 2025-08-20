-- Create export function for active contacts with specific column order
CREATE OR REPLACE FUNCTION private.export_active_contacts_csv()
RETURNS TEXT AS $$
DECLARE
    csv_output TEXT;
    today_formatted TEXT;
BEGIN
    -- Format today's date as "XXth Month" (e.g., "20th August")
    SELECT 
        CASE 
            WHEN EXTRACT(DAY FROM CURRENT_DATE) IN (1, 21, 31) THEN EXTRACT(DAY FROM CURRENT_DATE) || 'st'
            WHEN EXTRACT(DAY FROM CURRENT_DATE) IN (2, 22) THEN EXTRACT(DAY FROM CURRENT_DATE) || 'nd'
            WHEN EXTRACT(DAY FROM CURRENT_DATE) IN (3, 23) THEN EXTRACT(DAY FROM CURRENT_DATE) || 'rd'
            ELSE EXTRACT(DAY FROM CURRENT_DATE) || 'th'
        END || ' ' || TO_CHAR(CURRENT_DATE, 'Month')
    INTO today_formatted;
    
    WITH active_contacts AS (
        SELECT 
            ct.name,
            ct.email,
            ct.phone,
            CASE 
                WHEN c.website IS NOT NULL AND c.website != '' THEN c.website
                WHEN ct.email IS NOT NULL AND ct.email != '' THEN 
                    'https://' || split_part(ct.email, '@', 2)
                WHEN c.email IS NOT NULL AND array_length(c.email, 1) > 0 AND c.email[1] != '' THEN
                    'https://' || split_part(c.email[1], '@', 2)
                ELSE ''
            END as website,
            c.phone as company_phone,
            ct.created_at
        FROM public.contacts ct
        JOIN public.companies c ON ct.company_id = c.id
        WHERE ct.status = 'active'
        ORDER BY ct.created_at DESC
    )
    SELECT string_agg(csv_row, E'\n') INTO csv_output
    FROM (
        SELECT 'Today''s Date,name,email,companyWebsite,companyPhoneNumber,phone_number' AS csv_row
        UNION ALL
        SELECT 
            '"' || REPLACE(today_formatted, '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ac.name, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ac.email, ''), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ac.website, ''), '"', '""') || '",' ||
            '"' || REPLACE(array_to_string(COALESCE(ac.company_phone, '{}'), ';'), '"', '""') || '",' ||
            '"' || REPLACE(COALESCE(ac.phone, ''), '"', '""') || '"' AS csv_row
        FROM active_contacts ac
    ) all_data;
    
    RETURN COALESCE(csv_output, '');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;