-- Add separate name columns to contacts table
-- Keep existing 'name' column for backward compatibility
ALTER TABLE public.contacts 
ADD COLUMN first_name TEXT,
ADD COLUMN middle_name TEXT,
ADD COLUMN last_name TEXT;

-- Create index on first_name for better query performance
CREATE INDEX idx_contacts_first_name ON public.contacts(first_name);