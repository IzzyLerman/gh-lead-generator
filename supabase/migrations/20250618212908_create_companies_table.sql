CREATE TABLE public.companies (
 id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
 name TEXT NOT NULL,
 industry TEXT[] DEFAULT '{}',
 primary_email TEXT DEFAULT '',
 email TEXT[] DEFAULT '{}',
 primary_phone TEXT DEFAULT '',
 phone TEXT[] DEFAULT '{}',
 city TEXT DEFAULT '',
 state TEXT DEFAULT '',
 status TEXT DEFAULT 'enriching',
 email_message TEXT DEFAULT NULL,
 text_message TEXT DEFAULT NULL,
 "group" TEXT DEFAULT 'new',
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

create policy "block_all"
on public.companies
for ALL
to public
using (false)
with check (false);
