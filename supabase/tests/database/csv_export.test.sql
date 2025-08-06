BEGIN;

SELECT plan(11);

-- Test 1: Test that export_companies_csv function exists and can be called
SELECT lives_ok(
    $$ SELECT private.export_companies_csv() $$,
    'Should be able to call export_companies_csv function'
);

-- Test 2: Test that export_contacts_csv function exists and can be called
SELECT lives_ok(
    $$ SELECT private.export_contacts_csv() $$,
    'Should be able to call export_contacts_csv function'
);

-- Test 3: Verify companies CSV contains header row
SELECT ok(
    (SELECT private.export_companies_csv() LIKE 'name,industry,email_list,phone_list,city,state,status,group,submitted_by,picture_location%'),
    'Companies CSV should start with proper header row'
);

-- Test 4: Verify contacts CSV contains header row
SELECT ok(
    (SELECT private.export_contacts_csv() LIKE 'company_name,contact_name,first_name,middle_name,last_name,title,email,phone,email_subject,email_body,text_message%'),
    'Contacts CSV should start with proper header row'
);

-- Test 5: Verify companies CSV contains seed data
SELECT ok(
    (SELECT private.export_companies_csv() LIKE '%ABC Plumbing Services%'),
    'Companies CSV should contain seed company data'
);

-- Test 6: Verify contacts CSV contains seed data with company information
SELECT ok(
    (SELECT private.export_contacts_csv() LIKE '%ABC Plumbing Services%John Smith%'),
    'Contacts CSV should contain seed contact data with company name'
);

-- Test 7: Test CSV format for array fields (semicolon-separated)
SELECT ok(
    (SELECT private.export_companies_csv() LIKE '%Plumbing;Home Services%'),
    'Companies CSV should format array fields with semicolon separators'
);

-- Test 8: Verify CSV quoting for fields that might contain commas or quotes
-- Insert a test company with problematic data for CSV
INSERT INTO public.companies (name, industry, city, state, email) 
VALUES ('Test, Company "Quotes"', ARRAY['Service, Support', 'Tech "Solutions"'], 'San Francisco', 'CA', ARRAY['test@example.com']);

-- Also insert a test contact for this company to test the contacts export includes company name
INSERT INTO public.contacts (name, title, email, phone, company_id)
VALUES ('Test Contact', 'Manager', 'contact@test.com', '555-123-4567', 
        (SELECT id FROM public.companies WHERE name = 'Test, Company "Quotes"'));

SELECT ok(
    (SELECT private.export_companies_csv() LIKE '%"Test, Company ""Quotes""%'),
    'Companies CSV should properly quote fields containing commas and quotes'
);

-- Test 9: Verify contacts CSV includes company name
SELECT ok(
    (SELECT private.export_contacts_csv() LIKE '%"Test, Company ""Quotes""%"Test Contact"%'),
    'Contacts CSV should include company name for each contact'
);

-- Test 10: Test companies CSV with vehicle photos data
-- Insert a test vehicle photo linked to the test company
INSERT INTO public."vehicle-photos" (name, submitted_by, location, company_id)
VALUES ('test-photo.jpg', 'test@example.com', 'San Francisco, CA', 
        (SELECT id FROM public.companies WHERE name = 'Test, Company "Quotes"'));

SELECT ok(
    (SELECT private.export_companies_csv() LIKE '%test@example.com%San Francisco, CA%'),
    'Companies CSV should include submitted_by and picture_location from vehicle photos'
);

-- Test 11: Test companies CSV with NULL photo data (should show empty strings)
-- Insert a test company without vehicle photos
INSERT INTO public.companies (name, industry, city, state, email) 
VALUES ('No Photos Company', ARRAY['Test Industry'], 'Test City', 'TS', ARRAY['test@nophotos.com']);

SELECT ok(
    (SELECT private.export_companies_csv() LIKE '%No Photos Company%,"",""'),
    'Companies CSV should show empty strings for companies without vehicle photos'
);

-- Clean up test data
DELETE FROM public."vehicle-photos" WHERE name = 'test-photo.jpg';
DELETE FROM public.contacts WHERE name = 'Test Contact';
DELETE FROM public.companies WHERE name = 'Test, Company "Quotes"';
DELETE FROM public.companies WHERE name = 'No Photos Company';

SELECT finish();

ROLLBACK;