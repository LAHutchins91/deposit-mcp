# Durable JSON store (prep only)

Keeps the exact same JSON document shape as the local file store, but persists one row in `deposit_private.store`.

## Enable
1. Apply `durable_json_store.sql` in Supabase project for deposit.
2. Expose `deposit_private` to PostgREST **or** rely on service-role + `Accept-Profile` / `Content-Profile` headers (the app sends both).
3. Set Vercel env `SUPABASE_SERVICE_ROLE_KEY` (server-only). `SUPABASE_URL` already present.
4. Redeploy. Without the service role key, the app keeps using local JSON (`DEPOSIT_DATA_PATH` or `~/.deposit/deposit.json`).

## Concurrency
Writes use optimistic `revision` compare-and-swap with retries so concurrent instances do not clobber each other.
