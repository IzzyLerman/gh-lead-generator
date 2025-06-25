-- Fix vehicle_photos foreign key constraint to reference companies table
-- Drop existing incorrect constraint
ALTER TABLE public."vehicle-photos" DROP CONSTRAINT IF EXISTS fk_company;

-- Change company_id column type to UUID to match companies.id
ALTER TABLE public."vehicle-photos" ALTER COLUMN company_id TYPE UUID USING company_id::text::uuid;

-- Add correct foreign key constraint
ALTER TABLE public."vehicle-photos"
ADD CONSTRAINT fk_company
FOREIGN KEY (company_id) REFERENCES public.companies(id)
ON DELETE SET NULL;