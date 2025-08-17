BEGIN;

SELECT plan(4);

-- Test that upsert_company skips processing companies with 'sent' status

-- Create a company with 'sent' status
INSERT INTO public.companies (name, email, phone, industry, city, state, website, status, "group")
VALUES (
    'Test Company With Sent Status',
    ARRAY['test@sentcompany.com'],
    ARRAY['5551234567'],
    ARRAY['plumbing'],
    'Austin',
    'TX',
    'sentcompany.com',
    'sent',
    'contacted'
);

-- Get the company ID for later use
SELECT id INTO TEMPORARY TABLE sent_company_id FROM public.companies WHERE name = 'Test Company With Sent Status';

-- Test 1: Verify the company exists with 'sent' status
SELECT is(
    (SELECT status FROM public.companies WHERE name = 'Test Company With Sent Status'),
    'sent',
    'Company should have sent status'
);

-- Test 2: Try to upsert the same company (by name) and verify it gets skipped
SELECT is(
    (SELECT jsonb_extract_path_text(
        private.upsert_company(
            'Test Company With Sent Status',
            'newemail@sentcompany.com',
            '5559876543',
            ARRAY['electrical'],
            'Dallas',
            'TX',
            'newwebsite.com'
        ),
        'skipped'
    ))::boolean,
    true,
    'Company with sent status should be skipped'
);

-- Test 3: Verify the skip reason is correct
SELECT is(
    jsonb_extract_path_text(
        private.upsert_company(
            'Test Company With Sent Status',
            'anotheremail@sentcompany.com',
            '5555555555',
            ARRAY['hvac'],
            'Houston',
            'TX',
            'anotherwebsite.com'
        ),
        'reason'
    ),
    'this company has already been contacted',
    'Skip reason should indicate company has already been contacted'
);

-- Test 4: Verify the company data was not updated
SELECT is(
    (SELECT array_length(email, 1) FROM public.companies WHERE name = 'Test Company With Sent Status'),
    1,
    'Company email array should remain unchanged when skipped'
);

SELECT * FROM finish();

ROLLBACK;