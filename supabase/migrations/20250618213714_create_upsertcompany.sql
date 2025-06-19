CREATE OR REPLACE FUNCTION public.upsert_company(p_name TEXT, p_email TEXT, p_phone TEXT, p_industry TEXT[], p_city TEXT, p_state TEXT)
RETURNS VOID AS $$
DECLARE
    v_company_id UUID;
BEGIN
    -- Check if a company with the given name already exists.
    SELECT id INTO v_company_id FROM public.companies WHERE name = p_name;

    IF v_company_id IS NOT NULL THEN
        -- Company exists, so update it.
        UPDATE public.companies
        SET
            email = CASE
                WHEN p_email IS NULL OR p_email = ANY(email) THEN email
                ELSE array_append(email, p_email)
            END,
            "phone" = CASE
                WHEN p_phone IS NULL OR p_phone = ANY("phone") THEN "phone"
                ELSE array_append("phone", p_phone)
            END,
            -- To merge arrays and remove duplicates, we unnest the combined array,
            -- select distinct values, and then aggregate them back into a new array.
            industry = (
                SELECT array_agg(DISTINCT T.industry)
                FROM unnest(industry || p_industry) AS T(industry)
            ),
            city = CASE
                WHEN p_city IS NULL OR p_city = ANY(city) THEN city
                ELSE array_append(city, p_city)
            END,
            state = CASE
                WHEN p_state IS NULL OR p_state = ANY(state) THEN state
                ELSE array_append(state, p_state)
            END
        WHERE id = v_company_id;
    ELSE
        -- Company does not exist, so insert a new one.
        INSERT INTO public.companies (name, email, "phone", industry, city, state)
        VALUES (p_name, ARRAY[p_email], ARRAY[p_phone], p_industry, ARRAY[p_city], ARRAY[p_state]);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
