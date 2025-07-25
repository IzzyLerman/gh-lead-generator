-- Replace the 'message' field with separate message fields in contacts table
ALTER TABLE public.contacts 
DROP COLUMN IF EXISTS message;

-- Add new message fields
ALTER TABLE public.contacts 
ADD COLUMN email_subject TEXT,
ADD COLUMN email_body TEXT,
ADD COLUMN text_message TEXT;