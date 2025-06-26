-- Add columns to vehicle-photos table
ALTER TABLE public."vehicle-photos" 
ADD COLUMN submitted_by TEXT,
ADD COLUMN location TEXT;

-- Remove columns from companies table
ALTER TABLE public.companies 
DROP COLUMN primary_email,
DROP COLUMN primary_phone, 
DROP COLUMN email_message,
DROP COLUMN text_message;

-- Add status column to contacts table
ALTER TABLE public.contacts 
ADD COLUMN status TEXT;