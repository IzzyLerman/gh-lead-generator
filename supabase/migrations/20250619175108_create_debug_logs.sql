CREATE TABLE debug_logs (
  id SERIAL PRIMARY KEY,
  message TEXT,
  created_at TIMESTAMP DEFAULT now()
);

ALTER TABLE public."debug_logs" ENABLE ROW LEVEL SECURITY;

create policy "block_all"
on "public"."debug_logs"
for ALL
to public
using (false)
with check (false);
