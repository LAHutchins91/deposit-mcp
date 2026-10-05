-- Durable JSON document store for Deposit (same shape as local ~/.deposit/deposit.json).
-- Apply only after the owner decides to use Supabase for app data (not OAuth-only).
-- Requires SUPABASE_SERVICE_ROLE_KEY on the Vercel project. Do not expose this table to anon/authenticated.
-- Access is via public SECURITY DEFINER RPCs granted only to service_role (no PostgREST schema expose needed).

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

create or replace function public.deposit_store_load(p_id text default 'main')
returns jsonb
language plpgsql
security definer
set search_path = deposit_private, public
as $$
declare
  result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  select jsonb_build_object('doc', doc, 'revision', revision)
    into result
  from deposit_private.store
  where id = p_id;
  return result;
end;
$$;

create or replace function public.deposit_store_save(p_id text, p_doc jsonb, p_expected_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = deposit_private, public
as $$
declare
  new_rev bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;

  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'invalid revision';
  end if;

  if p_expected_revision = 0 then
    insert into deposit_private.store (id, doc, revision, updated_at)
    values (p_id, p_doc, 1, now())
    on conflict (id) do nothing
    returning revision into new_rev;
    if new_rev is null then
      return jsonb_build_object('ok', false, 'conflict', true);
    end if;
    return jsonb_build_object('ok', true, 'revision', new_rev);
  end if;

  update deposit_private.store
  set doc = p_doc,
      revision = revision + 1,
      updated_at = now()
  where id = p_id and revision = p_expected_revision
  returning revision into new_rev;

  if new_rev is null then
    return jsonb_build_object('ok', false, 'conflict', true);
  end if;
  return jsonb_build_object('ok', true, 'revision', new_rev);
end;
$$;

revoke all on function public.deposit_store_load(text) from public, anon, authenticated;
revoke all on function public.deposit_store_save(text, jsonb, bigint) from public, anon, authenticated;
grant execute on function public.deposit_store_load(text) to service_role;
grant execute on function public.deposit_store_save(text, jsonb, bigint) to service_role;

comment on table deposit_private.store is 'Deposit local JSON document.';
comment on function public.deposit_store_load(text) is 'Service-role-only load of durable JSON store row.';
comment on function public.deposit_store_save(text, jsonb, bigint) is 'Service-role-only CAS save of durable JSON store row; expected_revision 0 inserts.';
