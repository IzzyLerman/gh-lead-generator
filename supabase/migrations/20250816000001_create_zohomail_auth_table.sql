-- Create table to store ZohoMail OAuth tokens
CREATE TABLE public.zohomail_auth (
    id SERIAL PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on the table
ALTER TABLE public.zohomail_auth ENABLE ROW LEVEL SECURITY;

-- Create fully restrictive RLS policy - block all access to public
CREATE POLICY "block_all"
ON public.zohomail_auth
FOR ALL
USING (false)
WITH CHECK (false);

-- Create function to update updated_at timestamp in private schema
CREATE OR REPLACE FUNCTION private.update_zohomail_auth_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    SET search_path = private, public, extensions;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_zohomail_auth_updated_at_trigger
    BEFORE UPDATE ON public.zohomail_auth
    FOR EACH ROW
    EXECUTE FUNCTION private.update_zohomail_auth_updated_at();