-- Fix upsert_company function for updated schema
-- Remove references to primary_email and primary_phone columns that no longer exist

CREATE OR REPLACE FUNCTION private.upsert_company(p_name TEXT, p_email TEXT, p_phone TEXT, p_industry TEXT[], p_city TEXT, p_state TEXT)
RETURNS UUID AS $$
DECLARE
    v_company_id UUID;
    v_normalized_name TEXT;
    v_normalized_email TEXT;
    v_normalized_phone TEXT;
BEGIN
    v_normalized_name := normalize_company_name(p_name);
    v_normalized_email := CASE WHEN p_email IS NOT NULL AND p_email != '' THEN normalize_email(p_email) ELSE NULL END;
    v_normalized_phone := CASE WHEN p_phone IS NOT NULL AND p_phone != '' THEN normalize_phone(p_phone) ELSE NULL END;

    -- Find existing company with priority: name, email, phone
    SELECT id INTO v_company_id 
    FROM public.companies 
    WHERE normalize_company_name(name) = v_normalized_name;

    -- If no name match and email provided, check for email match
    IF v_company_id IS NULL AND v_normalized_email IS NOT NULL THEN
        SELECT id INTO v_company_id 
        FROM public.companies 
        WHERE v_normalized_email = ANY(
            SELECT normalize_email(unnest(email))
            WHERE email IS NOT NULL AND email != '{}'
        );
    END IF;

    -- If no name/email match and phone provided, check for phone match
    IF v_company_id IS NULL AND v_normalized_phone IS NOT NULL THEN
        SELECT id INTO v_company_id 
        FROM public.companies 
        WHERE v_normalized_phone = ANY(
            SELECT normalize_phone(unnest(phone))
            WHERE phone IS NOT NULL AND phone != '{}'
        );
    END IF;

    IF v_company_id IS NOT NULL THEN
        -- Company exists, so update it by merging data
        UPDATE public.companies
        SET
            -- Add to email array if not already present
            email = CASE
                WHEN p_email IS NULL OR p_email = '' OR normalize_email(p_email) = ANY(
                    SELECT normalize_email(unnest(email)) 
                ) THEN email
                ELSE array_append(email, p_email)
            END,
            -- Add to phone array if not already present
            phone = CASE
                WHEN p_phone IS NULL OR p_phone = '' OR normalize_phone(p_phone) = ANY(
                    SELECT normalize_phone(unnest(phone))
                ) THEN phone
                ELSE array_append(phone, p_phone)
            END,
            -- Merge industry arrays and remove duplicates
            industry = (
                SELECT array_agg(DISTINCT industry_item)
                FROM (
                    SELECT unnest(industry) AS industry_item
                    UNION
                    SELECT unnest(p_industry) AS industry_item
                ) combined_industries
                WHERE industry_item IS NOT NULL AND industry_item != ''
            ),
            -- Add city if not already present
            city = CASE
                WHEN p_city IS NULL OR p_city = '' OR p_city = city THEN city
                ELSE p_city
            END,
            -- Add state if not already present  
            state = CASE
                WHEN p_state IS NULL OR p_state = '' OR p_state = state THEN state
                ELSE p_state
            END,
            updated_at = NOW()
        WHERE id = v_company_id;
    ELSE
        -- Company does not exist, so insert a new one
        INSERT INTO public.companies (name, email, phone, industry, city, state, status, "group")
        VALUES (
            p_name, 
            CASE WHEN p_email IS NOT NULL AND p_email != '' THEN ARRAY[p_email] ELSE '{}' END,
            CASE WHEN p_phone IS NOT NULL AND p_phone != '' THEN ARRAY[p_phone] ELSE '{}' END,
            COALESCE(p_industry, '{}'),
            COALESCE(p_city, ''),
            COALESCE(p_state, ''),
            'enriching',
            'new'
        ) RETURNING id INTO v_company_id;
    END IF;
    
    RETURN v_company_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = private;