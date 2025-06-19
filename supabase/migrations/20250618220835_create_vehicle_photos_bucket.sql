insert into storage.buckets
    (id, name, public, allowed_mime_types, file_size_limit)
values
    ('gh-vehicle-photos', 'gh-vehicle-photos', true, ARRAY['image/*'], 10000000);

create policy "policy_name"
on storage.objects for insert to authenticated with check (
    -- restrict bucket
    bucket_id = 'my_bucket_id'
);


