-- Add verifalia_email_valid column to contacts table for caching email verification results
ALTER TABLE public.contacts 
ADD COLUMN verifalia_email_valid TEXT;