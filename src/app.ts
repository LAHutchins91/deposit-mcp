import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { PRO_REQUIRED, PUBLIC_MCP_METHODS, SIGN_IN_REQUIRED, hasDepositAccess } from "./access.js";
import { checkoutForm, depositUserId, readStripeEvent, stripePost, subscriptionPatch } from "./billing.js";
import { createFileDepositStore, defaultDepositDataPath, type DepositStore } from "./deposit-store.js";
import { createDepositMcpServer } from "./deposit-tools.js";
import { MCP_CORS_HEADERS, mcpBrowserOriginAllowed } from "./mcp-clients.js";
import { validateMcpClaims } from "./mcp-claims.js";
import { installPluginAuth } from "./plugin-auth.js";
import { installPublicPages } from "./public-pages.js";
import { DEPOSIT_VERSION } from "./version.js";

export type AuthUser = { id: string; email?: string };

export type DepositDeps = {
  appBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripePriceMonthly: string;
  stripePriceYearly: string;
  store: DepositStore;
  authenticate: (req: Request) => Promise<{ user: AuthUser; token: string }>;
  validateClaims: (token: string, userId: string) => void;
  fetchImpl?: typeof fetch;
};

const publicLimits = new Map<string, { count: number; end: number }>();

function allowPublic(key: string, limit: number, ms: number): boolean {
  const now = Date.now();
  for (const [entry, value] of publicLimits) if (value.end <= now) publicLimits.delete(entry);
  const current = publicLimits.get(key);
  if (current) {
    current.count += 1;
    return current.count <= limit;
  }
  if (publicLimits.size >= 10000) return false;
  publicLimits.set(key, { count: 1, end: now + ms });
  return true;
}

export async function authenticateWithSupabase(req: Request, supabaseUrl: string, anonKey: string): Promise<{ user: AuthUser; token: string }> {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !supabaseUrl || !anonKey) throw new Error("Authentication required");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "GET",
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error("Invalid authentication token");
  const user = await response.json() as AuthUser;
  if (!user?.id) throw new Error("Invalid authentication token");
  return { user: { id: user.id, email: user.email }, token };
}

export function defaultDeps(): DepositDeps {
  const appBaseUrl = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? "";
  return {
    appBaseUrl,
    supabaseUrl,
    supabaseAnonKey,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    stripePriceMonthly: process.env.STRIPE_PRICE_MONTHLY ?? "",
    stripePriceYearly: process.env.STRIPE_PRICE_YEARLY ?? "",
    store: createFileDepositStore(process.env.DEPOSIT_DATA_PATH ?? defaultDepositDataPath()),
    authenticate: (req) => authenticateWithSupabase(req, supabaseUrl, supabaseAnonKey),
    validateClaims: (token, userId) => validateMcpClaims(token, userId, `${supabaseUrl}/auth/v1`, `${appBaseUrl}/mcp`)
  };
}

function bearerChallenge(appBaseUrl: string): string {
  return `Bearer resource_metadata="${appBaseUrl}/.well-known/oauth-protected-resource/mcp"`;
}

export function createApp(deps: DepositDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store"
    });
    next();
  });

  app.post("/billing/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const signature = req.header("stripe-signature");
      if (!signature || !Buffer.isBuffer(req.body) || !deps.stripeWebhookSecret) {
        return res.status(400).send("Missing Stripe signature");
      }
      const event = readStripeEvent(req.body, signature, deps.stripeWebhookSecret);
      const object = event.data.object;
      const userId = depositUserId(object);
      if (userId && event.type === "checkout.session.completed") {
        await deps.store.updateProfile(userId, {
          stripeCustomerId: typeof object.customer === "string" ? object.customer : null,
          stripeSubscriptionId: typeof object.subscription === "string" ? object.subscription : null
        });
      }
      if (userId && ["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
        await deps.store.updateProfile(userId, subscriptionPatch(object));
      }
      res.json({ received: true });
    } catch {
      res.status(400).send("Webhook could not be processed");
    }
  });

  app.use(express.json({ limit: "128kb" }));
  installPublicPages(app, deps.appBaseUrl, deps.supabaseUrl, deps.supabaseAnonKey);
  installPluginAuth(app, deps.appBaseUrl, deps.supabaseUrl, deps.supabaseAnonKey);

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "deposit",
      version: DEPOSIT_VERSION,
      oauthConfigured: Boolean(deps.supabaseUrl && deps.supabaseAnonKey),
      billingConfigured: Boolean(deps.stripeSecretKey && deps.stripePriceMonthly && deps.stripePriceYearly)
    });
  });

  app.get("/api/account", async (req, res) => {
    try {
      const { user } = await deps.authenticate(req);
      const profile = await deps.store.getProfile(user.id);
      res.json({
        email: user.email ?? null,
        subscriptionStatus: profile.subscriptionStatus,
        access: hasDepositAccess(profile.subscriptionStatus)
      });
    } catch {
      res.status(401).json({ error: "Sign in to Deposit." });
    }
  });

  app.post("/api/support", async (req, res) => {
    if (!allowPublic(`support:${req.ip}`, 5, 3_600_000)) {
      return res.status(429).json({ error: "Too many requests. Please try again in an hour." });
    }
    const input = z.object({
      email: z.string().email().max(254),
      message: z.string().trim().min(10).max(4000)
    }).safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: "Enter a valid reply email and a message of 10–4000 characters." });
    try {
      const saved = await deps.store.addSupportRequest(input.data);
      res.json(saved);
    } catch {
      res.status(503).json({ error: "Support could not receive your request. Please retry later." });
    }
  });

  app.post("/billing/checkout", async (req, res) => {
    try {
      const { user } = await deps.authenticate(req);
      const plan = req.body?.plan === "annual" ? "annual" : "monthly";
      const price = plan === "annual" ? deps.stripePriceYearly : deps.stripePriceMonthly;
      if (!deps.stripeSecretKey || !price) return res.status(400).json({ error: "Billing is not configured on this server." });
      const profile = await deps.store.getProfile(user.id);
      const params = checkoutForm({
        userId: user.id,
        email: user.email,
        customerId: profile.stripeCustomerId,
        priceId: price,
        appBaseUrl: deps.appBaseUrl
      });
      const session = await stripePost<{ id: string; url: string }>(deps.stripeSecretKey, "checkout/sessions", params, deps.fetchImpl);
      res.json({ id: session.id, url: session.url });
    } catch {
      res.status(400).json({ error: "Unable to create checkout. Verify sign-in and retry." });
    }
  });

  app.post("/billing/portal", async (req, res) => {
    try {
      const { user } = await deps.authenticate(req);
      const profile = await deps.store.getProfile(user.id);
      if (!profile.stripeCustomerId || !deps.stripeSecretKey) {
        return res.status(400).json({ error: "Billing management is not available for this account yet." });
      }
      const params = new URLSearchParams({ customer: profile.stripeCustomerId, return_url: deps.appBaseUrl });
      const session = await stripePost<{ url: string }>(deps.stripeSecretKey, "billing_portal/sessions", params, deps.fetchImpl);
      res.json({ url: session.url });
    } catch {
      res.status(400).json({ error: "Unable to open billing management. Verify sign-in and retry." });
    }
  });

  function guardMcpOrigin(req: Request, res: Response): boolean {
    const origin = req.header("origin");
    if (!mcpBrowserOriginAllowed(origin, deps.appBaseUrl)) {
      res.status(403).json({ error: "Origin is not allowed." });
      return false;
    }
    if (origin) res.set({ ...MCP_CORS_HEADERS, "Access-Control-Allow-Origin": origin, Vary: "Origin" });
    return true;
  }

  app.options("/mcp", (req, res) => {
    if (!guardMcpOrigin(req, res)) return;
    res.status(204).end();
  });

  app.post("/mcp", async (req, res) => {
    if (!guardMcpOrigin(req, res)) return;
    if (!allowPublic(`mcp:${req.ip}`, 300, 60_000)) {
      return res.status(429).set("Retry-After", "60").json({ error: "Too many requests. Retry in one minute." });
    }
    const method = typeof req.body?.method === "string" ? req.body.method : "";
    let userId = "";
    let entitled = false;
    if (!PUBLIC_MCP_METHODS.has(method)) {
      try {
        const auth = await deps.authenticate(req);
        deps.validateClaims(auth.token, auth.user.id);
        userId = auth.user.id;
      } catch {
        res.set("WWW-Authenticate", bearerChallenge(deps.appBaseUrl));
        return res.status(401).json({ error: SIGN_IN_REQUIRED });
      }
      try {
        const profile = await deps.store.getProfile(userId);
        if (!hasDepositAccess(profile.subscriptionStatus)) {
          return res.status(403).json({
            error: PRO_REQUIRED,
            access_information: `${deps.appBaseUrl}/access`
          });
        }
      } catch {
        return res.status(503).json({ error: "Could not verify your subscription. Please retry." });
      }
      entitled = true;
    }
    let server: McpServer | undefined;
    try {
      server = createDepositMcpServer({ userId, entitled, store: deps.store });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server?.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: "Unable to process the plugin request." });
    }
  });

  app.get("/mcp", (req, res) => {
    if (!guardMcpOrigin(req, res)) return;
    res.set("WWW-Authenticate", bearerChallenge(deps.appBaseUrl));
    res.status(401).json({ error: "Use Streamable HTTP POST with your Deposit connection." });
  });

  app.use((error: { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error?.type === "entity.too.large" ? 413 : 400).json({ error: "Invalid or oversized request." });
  });

  return app;
}
