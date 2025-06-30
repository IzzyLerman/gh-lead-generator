supabase db reset --local
supabase db test
deno test --allow-all --env-file=./supabase/functions/.env ./supabase 
deno test --allow-all --env-file=./supabase/functions/.env ./tests/e2e
