insert into storage.buckets 
    (id, name, public, allowed_mime_types, file_size_limit)
values
    ('gh-vehicle-photos', 'gh-vehicle-photos', false, ARRAY['image/*'], 10000000)
on conflict (id) do nothing;


create policy "block_all"
on storage.objects
for ALL
to public
using (false)
with check (false);


