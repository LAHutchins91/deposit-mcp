-- Bind OAuth tokens to this MCP resource while preserving the authenticated audience for RLS.
-- Adapt RESOURCE if APP_BASE_URL changes. After applying, enable the hook in Supabase:
-- Authentication → Auth Hooks → Customize Access Token Claims → public.deposit_access_token_hook
-- Then revoke existing grants at /connections and reconnect ChatGPT.

create schema if not exists deposit_private;
revoke all on schema deposit_private from public, anon, authenticated;
grant usage on schema deposit_private to supabase_auth_admin;

create table if not exists deposit_private.oauth_resources (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  resource text not null
);
grant select, insert on deposit_private.oauth_resources to supabase_auth_admin;

create or replace function public.deposit_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  claims jsonb := event->'claims';
  cid text := claims->>'client_id';
  sid uuid;
  resource text;
  matching boolean;
begin
  -- Google/web sessions retain their current claims and flow.
  if cid is null or cid = '' then
    return event;
  end if;

  sid := (claims->>'session_id')::uuid;
  select r.resource into resource from deposit_private.oauth_resources r where r.session_id = sid;

  if resource is null and event->>'authentication_method' = 'oauth_provider/authorization_code' then
    -- Native Supabase checks code, client, redirect URI, PKCE, and resource before invoking this hook.
    -- Reject ambiguous outstanding grants to another resource rather than guess one.
    select count(*) > 0 and bool_and(a.resource = 'https://deposit-continuity2.vercel.app/mcp')
      into matching
      from auth.oauth_authorizations a
     where a.client_id = cid::uuid
       and a.user_id = (claims->>'sub')::uuid
       and a.status::text = 'approved'
       and a.expires_at > now();
    if matching then
      resource := 'https://deposit-continuity2.vercel.app/mcp';
      insert into deposit_private.oauth_resources (session_id, resource)
      values (sid, resource)
      on conflict do nothing;
    end if;
  end if;

  if resource is not null then
    claims := jsonb_set(claims, '{aud}', jsonb_build_array('authenticated', resource));
  end if;

  return jsonb_set(event, '{claims}', claims);
end
$fn$;

revoke all on function public.deposit_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.deposit_access_token_hook(jsonb) to supabase_auth_admin;

create or replace function public.verify_deposit_connection()
returns boolean
language sql
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from auth.sessions s
      join deposit_private.oauth_resources r on r.session_id = s.id
      join auth.oauth_consents c on c.user_id = s.user_id and c.client_id = s.oauth_client_id
     where s.id = (auth.jwt()->>'session_id')::uuid
       and s.user_id = auth.uid()
       and s.oauth_client_id = (auth.jwt()->>'client_id')::uuid
       and (s.not_after is null or s.not_after > now())
       and c.revoked_at is null
       and 'email' = any (string_to_array(coalesce(s.scopes, ''), ' '))
       and r.resource = 'https://deposit-continuity2.vercel.app/mcp'
  );
$fn$;

revoke all on function public.verify_deposit_connection() from public, anon;
grant execute on function public.verify_deposit_connection() to authenticated;
