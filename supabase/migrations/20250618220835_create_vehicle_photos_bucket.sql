insert into storage.buckets
    (id, name, public, allowed_mime_types, file_size_limit)
values
    ('gh-vehicle-photos', 'gh-vehicle-photos', false, ARRAY['image/*'], 10000000);

create policy "policy_name"
on storage.objects for insert to authenticated with check (
    -- restrict bucket
    bucket_id = 'my_bucket_id'
);

create policy "block_all"
on storage.objects
for ALL
to public
using (false)
with check (false);


