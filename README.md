# Deposit

Deposit keeps a freelancer's approved deposit and later payment dates, and what an assistant may tell the client, then lets an assistant read that record before it answers. An assistant cannot waive the deposit, mark it paid, or move a payment date unless that change is explicitly approved.

It works with ChatGPT, Claude, Gemini, Grok, and Cursor, plus any other MCP client that can do Streamable HTTP and OAuth. It is not a ChatGPT-only plugin.

Sign in with your Deposit account when the assistant opens OAuth. Do not paste an API key or password into a header. Deposit supports dynamic client registration: leave the client id and secret empty. The protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` points clients at the OAuth issuer, which registers them.

Deposit tools need Pro or an active trial. A new subscription includes a 14-day trial. This page does not list a price. Checkout shows the billing interval and payment terms. Amounts stored on a schedule are the freelancer's figures, in whole minor units of the schedule currency. They are not a product price.

To self-host, run the server and use the base URL you configure. The default MCP address is `http://127.0.0.1:3000/mcp`.

## Hosted server

- MCP server URL: `https://deposit-continuity2.vercel.app/mcp` (Streamable HTTP, OAuth sign-in)
- Docs: https://ouroborosapps.com/docs/deposit
- Status: early access. Paste the URL into Claude, Cursor, Grok, or ChatGPT developer mode.
- Registry name: `io.github.LAHutchins91/deposit`

## What the assistant can do

After you approve the connection, the server exposes these tools:

- list_schedules
- start_schedule
- read_schedule
- record_deposit
- add_later_payment
- move_payment_date
- waive_deposit
- mark_deposit_paid
- write_client_script
- commit_schedule
- suggest_schedule_change
- accept_schedule_change

`read_schedule` is the read the assistant should do before it answers. It includes the deposit, the later payment dates, and what the assistant may tell the client. Draft figures are not an approved commitment. A suggested schedule change does not change the record. After the schedule is committed, `waive_deposit` refuses a waiver, `mark_deposit_paid` refuses marking the deposit paid, and `move_payment_date` refuses a moved payment date. Those changes go through `suggest_schedule_change` and then `accept_schedule_change`, and only when you explicitly approve that change.

The assistant only calls these tools when you and the host allow it.

## Connect

Cursor, in `~/.cursor/mcp.json` or a project `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "deposit": {
      "url": "http://127.0.0.1:3000/mcp"
    }
  }
}
```

Do not add a headers block. Cursor registers a client and opens sign-in.

Claude Code:

```bash
claude mcp add --transport http deposit http://127.0.0.1:3000/mcp
```

Do not pass an Authorization header. Other clients use the same address, choose OAuth, and leave client id and secret empty. Steps for ChatGPT, Claude, Gemini, Grok, and Cursor are on the connect page at `/connect`.

Registry metadata for this server is in `server.json` (`io.github.LAHutchins91/deposit`). The remote URL there is `https://deposit-continuity2.vercel.app/mcp`.

## Run

```bash
npm install
npm test
npm run typecheck
npm run build
npm start
```

When stdin is a terminal, Deposit serves Streamable HTTP on port 3000. When stdin is not a terminal, it speaks MCP over stdio and still opens the HTTP port. Logs during stdio mode go to stderr so they do not mix with the protocol.

Records are stored durably in a JSON file. The default path is `~/.deposit/deposit.json`. Set `DEPOSIT_DATA_PATH` to move it. One server process owns that file. Do not point it at another product's data file.

OAuth uses the same idea as a Supabase authorization server with dynamic client registration. Set these on the server process, not in an MCP header:

- `APP_BASE_URL` (default `http://localhost:3000`)
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_MONTHLY` and `STRIPE_PRICE_YEARLY` (Stripe catalog ids, not prices)
- `OPENAI_APPS_CHALLENGE` (optional). When set, `GET /.well-known/openai-apps-challenge` returns that token as plain text for OpenAI domain verification. When unset, the route responds with `404` and the text `Verification is not configured.`

Tool calls other than discovery require a signed-in account whose subscription status is `active` or `trialing`.

---

More from Ouroboros: https://ouroborosapps.com
