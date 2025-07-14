-- Add zoominfo_id column to companies table
ALTER TABLE public.companies 
ADD COLUMN zoominfo_id BIGINT,
ADD COLUMN revenue BIGINT;

-- Add index on zoominfo_id for better query performance
CREATE INDEX idx_companies_zoominfo_id ON public.companies(zoominfo_id);
