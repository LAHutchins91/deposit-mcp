-- Durable JSON document store for Deposit (same shape as local ~/.deposit/deposit.json).
-- Apply only after the owner decides to use Supabase for app data (not OAuth-only).
-- Requires SUPABASE_SERVICE_ROLE_KEY on the Vercel project. Do not expose this table to anon/authenticated.

create schema if not exists deposit_private;
revoke all on schema deposit_private from public, anon, authenticated;

create table if not exists deposit_private.store (
  id text primary key,
  doc jsonb not null,
  revision bigint not null default 0,
  updated_at timestamptz not null default now()
);

revoke all on table deposit_private.store from public, anon, authenticated;
grant select, insert, update on table deposit_private.store to service_role;

-- PostgREST exposes schemas listed in the API settings. Prefer a public view owned by service_role only,
-- or add deposit_private to db.extra_search_path / exposed schemas carefully.
-- This migration keeps the table private; the Node service-role client should query via
-- REST with Accept-Profile / Content-Profile headers set to deposit_private.

comment on table deposit_private.store is 'Deposit local JSON document (version/profiles/domain records/supportRequests).';
