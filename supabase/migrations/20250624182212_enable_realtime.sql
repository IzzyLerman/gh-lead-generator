begin; 

drop
    publication if exists supabase_realtime;

create publication supabase_realtime;

commit;

alter
    publication supabase_realtime add table public.companies, public.contacts, public."vehicle-photos";
