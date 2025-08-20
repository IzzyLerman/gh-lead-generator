BEGIN;

SELECT plan(15);

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
    (SELECT private.export_companies_csv() LIKE 'name,industry,primary_industry,email,phone,city,state,zip_code,website,revenue,sic_codes,naics_codes,id,zoominfo_id,status,created_at,updated_at,submitted_by%'),
    'Companies CSV should start with proper header row'
);

-- Test 4: Verify contacts CSV contains header row
SELECT ok(
    (SELECT private.export_contacts_csv() LIKE 'name,company_name,title,email,phone,status,email_subject,email_body,text_message,first_name,middle_name,last_name,id,zoominfo_id%'),
    'Contacts CSV should start with proper header row'
);

-- Test 5: Verify companies CSV contains seed data
SELECT ok(
    (SELECT private.export_companies_csv() LIKE '%ABC Plumbing Services%'),
    'Companies CSV should contain seed company data'
);

-- Test 6: Verify contacts CSV contains seed data with company information
SELECT ok(
    (SELECT private.export_contacts_csv() LIKE '%John Smith%ABC Plumbing Services%'),
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
    (SELECT private.export_contacts_csv() LIKE '%"Test Contact"%"Test, Company ""Quotes""%'),
    'Contacts CSV should include company name for each contact'
);

-- Test 10: Test companies CSV with vehicle photos data
-- Insert a test vehicle photo linked to the test company
INSERT INTO public."vehicle-photos" (name, submitted_by, location, company_id)
VALUES ('test-photo.jpg', 'test@example.com', 'San Francisco, CA', 
        (SELECT id FROM public.companies WHERE name = 'Test, Company "Quotes"'));

SELECT ok(
    (SELECT private.export_companies_csv() LIKE '%test@example.com%'),
    'Companies CSV should include submitted_by from vehicle photos'
);


-- Test 12: Test that export_active_contacts_csv function exists and can be called
SELECT lives_ok(
    $$ SELECT private.export_active_contacts_csv() $$,
    'Should be able to call export_active_contacts_csv function'
);

-- Test 13: Verify active contacts CSV contains proper header row
SELECT ok(
    (SELECT private.export_active_contacts_csv() LIKE 'Today''s Date,name,email,companyWebsite,companyPhoneNumber,phone_number%'),
    'Active contacts CSV should start with proper header row'
);

-- Test 14: Test active contacts CSV with active status filter
-- Insert test data for active contacts
INSERT INTO public.companies (name, website, phone) 
VALUES ('Active Test Company', 'https://activetest.com', ARRAY['555-999-0000']);

INSERT INTO public.contacts (name, email, phone, status, company_id)
VALUES 
    ('Active Contact', 'active@test.com', '555-111-2222', 'active', 
     (SELECT id FROM public.companies WHERE name = 'Active Test Company')),
    ('Inactive Contact', 'inactive@test.com', '555-333-4444', 'inactive',
     (SELECT id FROM public.companies WHERE name = 'Active Test Company'));

SELECT ok(
    (SELECT private.export_active_contacts_csv() LIKE '%Active Contact%') AND
    (SELECT private.export_active_contacts_csv() NOT LIKE '%Inactive Contact%'),
    'Active contacts CSV should only include contacts with active status'
);

-- Test 15: Test domain extraction from contact email when company website is empty
INSERT INTO public.companies (name, website, email) 
VALUES ('Domain Test Company', NULL, ARRAY['info@domaintest.com']);

INSERT INTO public.contacts (name, email, phone, status, company_id)
VALUES ('Contact With Domain', 'contact@example.org', '555-777-8888', 'active',
        (SELECT id FROM public.companies WHERE name = 'Domain Test Company'));

SELECT ok(
    (SELECT private.export_active_contacts_csv() LIKE '%https://example.org%'),
    'Active contacts CSV should extract domain from contact email when company website is empty'
);

-- Test 16: Test domain extraction from company email when both website and contact email are empty
INSERT INTO public.companies (name, website, email) 
VALUES ('Company Email Domain Test', '', ARRAY['company@testdomain.net']);

INSERT INTO public.contacts (name, email, phone, status, company_id)
VALUES ('Contact No Email', '', '555-888-9999', 'active',
        (SELECT id FROM public.companies WHERE name = 'Company Email Domain Test'));

SELECT ok(
    (SELECT private.export_active_contacts_csv() LIKE '%https://testdomain.net%'),
    'Active contacts CSV should extract domain from company email when website and contact email are empty'
);

-- Clean up test data
DELETE FROM public.contacts WHERE name IN ('Active Contact', 'Inactive Contact', 'Contact With Domain', 'Contact No Email');
DELETE FROM public.companies WHERE name IN ('Active Test Company', 'Domain Test Company', 'Company Email Domain Test');
DELETE FROM public."vehicle-photos" WHERE name = 'test-photo.jpg';
DELETE FROM public.contacts WHERE name = 'Test Contact';
DELETE FROM public.companies WHERE name = 'Test, Company "Quotes"';
DELETE FROM public.companies WHERE name = 'No Photos Company';

SELECT finish();

ROLLBACK;
