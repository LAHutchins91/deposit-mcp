import http, { createServer, type Server } from "node:http";
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

function postMcp(baseUrl: string, accept: string | undefined, body: unknown) {
  const payload = JSON.stringify(body);
  const url = new URL(baseUrl);
  return new Promise<{ status: number; text: string; wwwAuthenticate?: string }>((resolve, reject) => {
    const requestHeaders: http.OutgoingHttpHeaders = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload)
    };
    if (accept !== undefined) requestHeaders.accept = accept;
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: "/mcp", method: "POST", headers: requestHeaders },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const wwwAuthenticate = res.headers["www-authenticate"];
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
            wwwAuthenticate: typeof wwwAuthenticate === "string" ? wwwAuthenticate : undefined
          });
        });
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
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

  it.each([
    ["application/json"],
    ["*/*"],
    ["text/event-stream"],
    [undefined],
    ["application/json, text/event-stream"]
  ] as const)("lists tools when Accept is %s", async (accept) => {
    const options = await deps();
    const url = await listen(createApp(options));
    const response = await postMcp(url, accept, { jsonrpc: "2.0", id: 11, method: "tools/list" });
    expect(response.status).toBe(200);
    const body = JSON.parse(response.text) as { result?: { tools?: Array<{ name: string }> }; error?: { message?: string } };
    expect(body.error?.message ?? "").not.toMatch(/Not Acceptable/);
    expect(body.result?.tools?.map((tool) => tool.name).sort()).toEqual([...DEPOSIT_TOOL_NAMES].sort());
  });

  it("still requires OAuth for tools/call when Accept is only application/json", async () => {
    const options = await deps("none");
    const url = await listen(createApp(options));
    const response = await postMcp(url, "application/json", {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "list_schedules", arguments: {} }
    });
    expect(response.status).toBe(401);
    expect(response.wwwAuthenticate).toContain("/.well-known/oauth-protected-resource/mcp");
    const body = JSON.parse(response.text) as { error?: string };
    expect(body.error).toBe(SIGN_IN_REQUIRED);
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

  it("serves the OpenAI domain challenge as plain text and a Continuity-grade privacy page", async () => {
    const previous = process.env.OPENAI_APPS_CHALLENGE;
    const options = await deps();
    const url = await listen(createApp(options));
    try {
      delete process.env.OPENAI_APPS_CHALLENGE;
      const missing = await fetch(`${url}/.well-known/openai-apps-challenge`);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("content-type")).toMatch(/text\/plain/);
      const missingBody = await missing.text();
      expect(missingBody).toBe("Verification is not configured.");
      expect(missingBody).not.toContain("<");

      process.env.OPENAI_APPS_CHALLENGE = "portal-token-value";
      const present = await fetch(`${url}/.well-known/openai-apps-challenge`);
      expect(present.status).toBe(200);
      expect(present.headers.get("content-type")).toMatch(/text\/plain/);
      expect(await present.text()).toBe("portal-token-value");

      const privacy = await fetch(`${url}/privacy`);
      expect(privacy.status).toBe(200);
      expect(privacy.headers.get("content-type")).toMatch(/text\/html/);
      const html = await privacy.text();
      for (const section of [
        "Effective October 5, 2026",
        "Ouroboros Apps",
        "Lawrence Hutchins",
        "href=\"/support\"",
        "account email",
        "deposit schedules",
        "later payments",
        "client wording",
        "Information we process",
        "Why and where",
        "Control and retention",
        "Security and changes",
        "do not sell schedule records",
        "ChatGPT",
        "Claude",
        "Gemini",
        "Grok",
        "Cursor",
        "Supabase",
        "Vercel",
        "Google",
        "Stripe"
      ]) {
        expect(html).toContain(section);
      }
      expect(html).not.toMatch(/\$\s*\d/);
      expect(html.toLowerCase()).not.toContain("dollar");

      const home = await fetch(`${url}/`);
      const homeHtml = await home.text();
      expect(homeHtml).toContain("Continue with Google");
      expect(homeHtml).toContain('provider:"google"');
    } finally {
      if (previous === undefined) delete process.env.OPENAI_APPS_CHALLENGE;
      else process.env.OPENAI_APPS_CHALLENGE = previous;
    }
  });
});
