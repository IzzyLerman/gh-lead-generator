BEGIN;

SELECT plan(9);

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
    (SELECT private.export_companies_csv() LIKE 'name,industry,primary_email,email_list,primary_phone,phone_list,city,state,status,group%'),
    'Companies CSV should start with proper header row'
);

-- Test 4: Verify contacts CSV contains header row
SELECT ok(
    (SELECT private.export_contacts_csv() LIKE 'company_name,contact_name,title,email,phone,message%'),
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
INSERT INTO public.companies (name, industry, city, state, primary_email) 
VALUES ('Test, Company "Quotes"', ARRAY['Service, Support', 'Tech "Solutions"'], 'San Francisco', 'CA', 'test@example.com');

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

-- Clean up test data
DELETE FROM public.contacts WHERE name = 'Test Contact';
DELETE FROM public.companies WHERE name = 'Test, Company "Quotes"';

SELECT finish();

ROLLBACK;