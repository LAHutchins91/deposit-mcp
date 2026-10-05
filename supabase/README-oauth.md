# Deposit OAuth resource binding

Continuity production requires a Supabase **Custom Access Token** hook that sets access-token `aud` to include the MCP resource URL (`APP_BASE_URL/mcp`). Without that binding, ChatGPT can finish the browser consent step (authorization `code` returned to `platform.openai.com`) while the portal still reports **Authorization for scanning is missing**, because the minted token is not audience-bound to Deposit.

## Apply once (Deposit Supabase project `uayvpvwwabvmkiynasyv`)

1. Run `oauth_resource_binding.sql` in the SQL editor.
2. Supabase Dashboard → Authentication → Auth Hooks → **Customize Access Token Claims** → point at `public.deposit_access_token_hook`.
3. Do not disable the hook while `validateMcpClaims` requires `aud` to include `https://deposit-continuity2.vercel.app/mcp`.
4. Visit `/connections`, disconnect OpenAI clients, then Connect again in the Apps portal.
5. Optional: call `verify_deposit_connection` from `/mcp` the same way Continuity calls `verify_continuity_connection` (server change, separate PR).

If `APP_BASE_URL` changes, update the hard-coded resource string in the SQL and re-apply before reconnecting clients.
