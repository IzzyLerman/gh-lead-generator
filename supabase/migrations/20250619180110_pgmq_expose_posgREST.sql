-- Ensure the schema exists
create schema if not exists pgmq_public;

-- Grant usage on the schema to API roles
grant usage on schema pgmq_public to postgres, service_role;

-- Wrapper functions in pgmq_public schema

create or replace function pgmq_public.pop(queue_name text)
returns setof pgmq.message_record
language plpgsql
set search_path = ''
as $$
begin
    return query
    select * from pgmq.pop(queue_name := queue_name);
end;
$$;

comment on function pgmq_public.pop(queue_name text) is
'Retrieves and locks the next message from the specified queue.';

create or replace function pgmq_public.send(queue_name text, message jsonb, sleep_seconds integer default 0)
returns setof bigint
language plpgsql
set search_path = ''
as $$
begin
    return query
    select * from pgmq.send(queue_name := queue_name, msg := message, delay := sleep_seconds);
end;
$$;

comment on function pgmq_public.send(queue_name text, message jsonb, sleep_seconds integer) is
'Sends a message to the specified queue, optionally delaying its availability by a number of seconds.';

create or replace function pgmq_public.send_batch(queue_name text, messages jsonb[], sleep_seconds integer default 0)
returns setof bigint
language plpgsql
set search_path = ''
as $$
begin
    return query
    select * from pgmq.send_batch(queue_name := queue_name, msgs := messages, delay := sleep_seconds);
end;
$$;

comment on function pgmq_public.send_batch(queue_name text, messages jsonb[], sleep_seconds integer) is
'Sends a batch of messages to the specified queue, optionally delaying their availability by a number of seconds.';

create or replace function pgmq_public.archive(queue_name text, message_id bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
    return pgmq.archive(queue_name := queue_name, msg_id := message_id);
end;
$$;

comment on function pgmq_public.archive(queue_name text, message_id bigint) is
'Archives a message by moving it from the queue to a permanent archive.';

create or replace function pgmq_public.delete(queue_name text, message_id bigint)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
    return pgmq.delete(queue_name := queue_name, msg_id := message_id);
end;
$$;

comment on function pgmq_public.delete(queue_name text, message_id bigint) is
'Permanently deletes a message from the specified queue.';

create or replace function pgmq_public.read(queue_name text, sleep_seconds integer, n integer)
returns setof pgmq.message_record
language plpgsql
set search_path = ''
as $$
begin
    return query
    select * from pgmq.read(queue_name := queue_name, vt := sleep_seconds, qty := n);
end;
$$;

comment on function pgmq_public.read(queue_name text, sleep_seconds integer, n integer) is
'Reads up to "n" messages from the specified queue with an optional "sleep_seconds" (visibility timeout).';

-- Grant EXECUTE on the wrapper functions to API roles
grant execute on function
    pgmq_public.pop(text),
    pgmq_public.send(text, jsonb, integer),
    pgmq_public.send_batch(text, jsonb[], integer),
    pgmq_public.archive(text, bigint),
    pgmq_public.delete(text, bigint),
    pgmq_public.read(text, integer, integer)
to postgres, service_role, anon, authenticated;

-- Grant EXECUTE on underlying pgmq functions (optional if used directly)
grant execute on function
    pgmq.pop(text),
    pgmq.send(text, jsonb, integer),
    pgmq.send_batch(text, jsonb[], integer),
    pgmq.archive(text, bigint),
    pgmq.delete(text, bigint),
    pgmq.read(text, integer, integer)
to postgres, service_role, anon, authenticated;

-- Grant table privileges for service_role
grant all privileges on all tables in schema pgmq to postgres, service_role;
alter default privileges in schema pgmq grant all privileges on tables to postgres, service_role;
grant usage on schema pgmq to postgres, service_role;

-- Grant usage and access to sequences
grant usage, select, update on all sequences in schema pgmq to service_role;
alter default privileges in schema pgmq grant usage, select, update on sequences to service_role;
