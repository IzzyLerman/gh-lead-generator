
CREATE extension IF NOT EXISTS pgmq CASCADE;
SELECT pgmq.create('image-processing');

-- networking
create extension IF NOT EXISTS pg_net;

-- restrictive RLS
ALTER TABLE pgmq."q_image-processing" ENABLE ROW LEVEL SECURITY;

create policy "block_all"
on "pgmq"."q_image-processing"
for ALL
to public
using (false)
with check (false);
