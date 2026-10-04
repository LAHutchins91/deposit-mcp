import crypto from "node:crypto";
import { TRIAL_PERIOD_DAYS } from "./access.js";

export { TRIAL_PERIOD_DAYS };

export type StripeEvent = { type: string; data: { object: Record<string, unknown> } };

export function readStripeEvent(rawBody: Buffer, signatureHeader: string, secret: string): StripeEvent {
  const fields = signatureHeader.split(",").map((part) => part.trim());
  const timestamp = fields.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = fields.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) throw new Error("Malformed Stripe signature");
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw new Error("Expired Stripe signature");
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const valid = signatures.some((signature) => {
    if (signature.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  });
  if (!valid) throw new Error("Invalid Stripe signature");
  return JSON.parse(rawBody.toString("utf8")) as StripeEvent;
}

export function checkoutForm(input: {
  userId: string;
  email?: string;
  customerId?: string | null;
  priceId: string;
  appBaseUrl: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", input.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("client_reference_id", input.userId);
  params.set("metadata[deposit_user_id]", input.userId);
  params.set("subscription_data[metadata][deposit_user_id]", input.userId);
  params.set("subscription_data[trial_period_days]", String(TRIAL_PERIOD_DAYS));
  params.set("payment_method_collection", "always");
  params.set("success_url", `${input.appBaseUrl}/?checkout=success`);
  params.set("cancel_url", `${input.appBaseUrl}/?checkout=cancelled`);
  if (input.customerId) params.set("customer", input.customerId);
  else if (input.email) params.set("customer_email", input.email);
  return params;
}

export async function stripePost<T>(
  secret: string,
  path: string,
  params: URLSearchParams,
  fetchImpl: typeof fetch = fetch
): Promise<T> {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Stripe ${response.status}`);
  return JSON.parse(body) as T;
}

export function subscriptionPatch(object: Record<string, unknown>) {
  const status = typeof object.status === "string" ? object.status : "unknown";
  const periodEnd = typeof object.current_period_end === "number"
    ? new Date(object.current_period_end * 1000).toISOString()
    : null;
  return {
    subscriptionStatus: status,
    stripeCustomerId: typeof object.customer === "string" ? object.customer : null,
    stripeSubscriptionId: typeof object.id === "string" ? object.id : null,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: Boolean(object.cancel_at_period_end)
  };
}

export function depositUserId(object: Record<string, unknown>): string | undefined {
  const metadata = (object.metadata ?? {}) as Record<string, unknown>;
  if (typeof metadata.deposit_user_id === "string") return metadata.deposit_user_id;
  if (typeof object.client_reference_id === "string") return object.client_reference_id;
  return undefined;
}
