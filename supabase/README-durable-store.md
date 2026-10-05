# Durable Supabase JSON store (Deposit)

Keeps the exact same JSON document shape as the local file store, but persists one row in `deposit_private.store`.

## Activate

1. Apply `durable_json_store.sql` (creates private table + public `SECURITY DEFINER` RPCs `deposit_store_load` / `deposit_store_save` granted only to `service_role`).
2. Set Vercel env `SUPABASE_SERVICE_ROLE_KEY` (server-only). `SUPABASE_URL` already present.
3. Redeploy. No PostgREST schema exposure is required — the app calls `/rest/v1/rpc/...` in the public schema.

Writes use optimistic `revision` compare-and-swap with retries so concurrent instances do not clobber each other.
