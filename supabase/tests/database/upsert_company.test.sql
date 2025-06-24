BEGIN;

SELECT plan(16);

-- Test 1: Insert new company with all fields
SELECT lives_ok(
    $$ SELECT private.upsert_company('Test Company Inc', 'test@example.com', '555-123-4567', ARRAY['Technology', 'Software'], 'San Francisco', 'CA') $$,
    'Should insert new company successfully'
);

-- Test 2: Verify company was inserted correctly
SELECT is(
    (SELECT COUNT(*) FROM public.companies WHERE name = 'Test Company Inc'),
    1::bigint,
    'Company should be inserted once'
);

-- Test 3: Verify normalized company name matching
SELECT lives_ok(
    $$ SELECT private.upsert_company('TEST COMPANY INC.', 'another@example.com', '555-987-6543', ARRAY['Tech'], 'Oakland', 'CA') $$,
    'Should match existing company by normalized name'
);

SELECT is(
    (SELECT COUNT(*) FROM public.companies WHERE private.normalize_company_name(name) = private.normalize_company_name('Test Company Inc')),
    1::bigint,
    'Should update existing company, not create duplicate'
);

-- Test 4: Verify email array was updated
SELECT ok(
    (SELECT 'another@example.com' = ANY(email) FROM public.companies WHERE name = 'Test Company Inc'),
    'Should add new email to existing company'
);

-- Test 5: Insert company with minimal data
SELECT lives_ok(
    $$ SELECT private.upsert_company('Minimal Co', NULL, NULL, NULL, NULL, NULL) $$,
    'Should insert company with minimal data'
);

-- Test 6: Test email matching when name doesn't match
INSERT INTO public.companies (name, primary_email, email) VALUES ('Different Name', 'unique@test.com', ARRAY['unique@test.com']);

SELECT lives_ok(
    $$ SELECT private.upsert_company('Another Name', 'unique@test.com', '123-456-7890', ARRAY['Finance'], 'NYC', 'NY') $$,
    'Should match existing company by email'
);

SELECT is(
    (SELECT phone[1] FROM public.companies WHERE primary_email = 'unique@test.com'),
    '123-456-7890',
    'Should update company matched by email'
);

-- Test 7: Test phone matching when name and email don't match
INSERT INTO public.companies (name, primary_phone, phone) VALUES ('Phone Company', '555-000-1111', ARRAY['555-000-1111']);

SELECT lives_ok(
    $$ SELECT private.upsert_company('Phone Match Test', 'newphone@test.com', '(555) 000-1111', ARRAY['Telecom'], 'Boston', 'MA') $$,
    'Should match existing company by normalized phone'
);

SELECT is(
    (SELECT primary_email FROM public.companies WHERE name = 'Phone Company'),
    'newphone@test.com',
    'Should update company matched by phone'
);

-- Test 8: Test industry array merging
SELECT lives_ok(
    $$ SELECT private.upsert_company('Test Company Inc', 'test3@example.com', '555-111-2222', ARRAY['Consulting', 'Technology'], 'LA', 'CA') $$,
    'Should merge industry arrays'
);

SELECT ok(
    (SELECT 'Consulting' = ANY(industry) FROM public.companies WHERE name = 'Test Company Inc'),
    'Should include new industry in merged array'
);

SELECT ok(
    (SELECT 'Technology' = ANY(industry) FROM public.companies WHERE name = 'Test Company Inc'),
    'Should preserve existing industry in merged array'
);

-- Test 9: Test normalization functions
SELECT is(
    private.normalize_company_name('Test Corp Inc.'),
    private.normalize_company_name('TEST CORP INC'),
    'Company name normalization should be case-insensitive and remove suffixes'
);

SELECT is(
    private.normalize_email('TEST@EXAMPLE.COM  '),
    'test@example.com',
    'Email normalization should lowercase and trim'
);

SELECT is(
    private.normalize_phone('(555) 123-4567'),
    '5551234567',
    'Phone normalization should remove all non-digits'
);

-- Clean up test data
DELETE FROM public.companies WHERE name IN ('Test Company Inc', 'Minimal Co', 'Different Name', 'Phone Company');

SELECT finish();

ROLLBACK;
