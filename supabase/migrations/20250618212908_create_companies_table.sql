CREATE TABLE companies (
 id SERIAL PRIMARY KEY,
 name TEXT NOT NULL,
 industry TEXT[] DEFAULT '{}',
 primary_email TEXT DEFAULT '',
 email TEXT[] DEFAULT '{}',
 primary_phone TEXT DEFAULT '',
 phone TEXT[] DEFAULT '{}',
 city TEXT DEFAULT '',
 state TEXT DEFAULT '',
 created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
 updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
