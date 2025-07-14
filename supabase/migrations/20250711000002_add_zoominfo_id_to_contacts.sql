-- Add zoominfo_id column to contacts table
ALTER TABLE public.contacts 
ADD COLUMN zoominfo_id BIGINT;

-- Add index on zoominfo_id for better query performance
CREATE INDEX idx_contacts_zoominfo_id ON public.contacts(zoominfo_id);