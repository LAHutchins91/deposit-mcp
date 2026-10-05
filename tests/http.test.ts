import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import crypto from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Express, Request } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { PRO_REQUIRED, SIGN_IN_REQUIRED } from "../src/access.js";
import app, { createApp, type DepositDeps } from "../src/app.js";
import { createFileDepositStore } from "../src/deposit-store.js";
import { DEPOSIT_TOOL_NAMES } from "../src/deposit-tools.js";
import { protectedResourceMetadata } from "../src/plugin-auth.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function listen(app: Express): Promise<string> {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function deps(status = "none"): Promise<DepositDeps & { file: string }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "deposit-"));
  const file = path.join(dir, "deposit.json");
  const store = createFileDepositStore(file);
  await store.updateProfile("user-1", { subscriptionStatus: status });
  const appBaseUrl = "http://127.0.0.1:3000";
  return {
    file,
    appBaseUrl,
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "public-anon",
    stripeSecretKey: "sk_test",
    stripeWebhookSecret: "whsec_test",
    stripePriceMonthly: "catalog_monthly",
    stripePriceYearly: "catalog_yearly",
    store,
    authenticate: async (req: Request) => {
      const header = req.header("authorization") ?? "";
      if (header !== "Bearer good-token") throw new Error("Authentication required");
      return { user: { id: "user-1", email: "freelancer@example.com" }, token: "good-token" };
    },
    validateClaims: (token: string) => {
      if (token !== "good-token") throw new Error("Reconnect Deposit");
    }
  };
}

function mcpHeaders(origin?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(origin ? { origin } : {})
  };
}

describe("HTTP MCP", () => {
  it("default-exports the Express app Vercel invokes", async () => {
    expect(typeof app).toBe("function");
    const url = await listen(app);
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual([...DEPOSIT_TOOL_NAMES].sort());
  });

  it("returns Deposit tools from tools/list without a credential", async () => {
    const options = await deps();
    const url = await listen(createApp(options));
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual([...DEPOSIT_TOOL_NAMES].sort());
  });

  it("requires OAuth and an active trial before a tool call", async () => {
    const locked = await deps("none");
    const lockedUrl = await listen(createApp(locked));
    const anonymous = await fetch(`${lockedUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "list_schedules", arguments: {} } })
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("www-authenticate")).toContain("/.well-known/oauth-protected-resource/mcp");
    await expect(anonymous.json()).resolves.toEqual({ error: SIGN_IN_REQUIRED });

    const forbidden = await fetch(`${lockedUrl}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders(), authorization: "Bearer good-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_schedules", arguments: {} } })
    });
    expect(forbidden.status).toBe(403);
    const forbiddenBody = await forbidden.json() as { error: string; access_information: string };
    expect(forbiddenBody.error).toBe(PRO_REQUIRED);
    expect(forbiddenBody.access_information).toBe("http://127.0.0.1:3000/access");

    const open = await deps("trialing");
    const openUrl = await listen(createApp(open));
    const allowed = await fetch(`${openUrl}/mcp`, {
      method: "POST",
      headers: { ...mcpHeaders("https://chatgpt.com"), authorization: "Bearer good-token" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "start_schedule", arguments: { clientName: "Ada", projectTitle: "Spring deposit", reference: "DEP-3", currency: "USD" } }
      })
    });
    expect(allowed.status).toBe(200);
    const allowedBody = await allowed.json() as { result: { content: Array<{ text: string }> } };
    expect(allowedBody.result.content[0]?.text).toContain("Spring deposit");

    const evil = await fetch(`${openUrl}/mcp`, {
      method: "POST",
      headers: mcpHeaders("https://evil.example"),
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" })
    });
    expect(evil.status).toBe(403);
  });

  it("advertises OAuth metadata and applies a trial from the billing webhook", async () => {
    const options = await deps("none");
    const url = await listen(createApp(options));
    const metadata = await fetch(`${url}/.well-known/oauth-protected-resource/mcp`);
    expect(await metadata.json()).toEqual(protectedResourceMetadata(options.appBaseUrl, options.supabaseUrl));

    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "trialing",
          cancel_at_period_end: false,
          metadata: { deposit_user_id: "user-1" }
        }
      }
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac("sha256", options.stripeWebhookSecret).update(`${timestamp}.${payload}`).digest("hex");
    const webhook = await fetch(`${url}/billing/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": `t=${timestamp},v1=${signature}` },
      body: payload
    });
    expect(webhook.status).toBe(200);
    expect((await options.store.getProfile("user-1")).subscriptionStatus).toBe("trialing");

    const health = await fetch(`${url}/health`);
    expect(await health.json()).toMatchObject({ ok: true, service: "deposit", oauthConfigured: true, billingConfigured: true });
  });
});
