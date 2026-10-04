import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasDepositAccess } from "../src/access.js";
import { TRIAL_PERIOD_DAYS, checkoutForm, readStripeEvent } from "../src/billing.js";

describe("billing", () => {
  it("starts checkout with a 14-day trial and no price", () => {
    expect(TRIAL_PERIOD_DAYS).toBe(14);
    expect(hasDepositAccess("trialing")).toBe(true);
    expect(hasDepositAccess("active")).toBe(true);
    expect(hasDepositAccess("none")).toBe(false);
    const params = checkoutForm({
      userId: "user-1",
      email: "freelancer@example.com",
      priceId: "catalog_monthly",
      appBaseUrl: "http://127.0.0.1:3000"
    });
    expect(params.get("subscription_data[trial_period_days]")).toBe("14");
    expect(params.get("metadata[deposit_user_id]")).toBe("user-1");
    expect(params.toString()).not.toMatch(/\$\d/);
    expect(params.toString().toLowerCase()).not.toContain("dollar");
  });

  it("verifies a Stripe signature", () => {
    const secret = "whsec_test";
    const payload = JSON.stringify({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", status: "trialing", metadata: { deposit_user_id: "user-1" } } }
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    const event = readStripeEvent(Buffer.from(payload), `t=${timestamp},v1=${signature}`, secret);
    expect(event.type).toBe("customer.subscription.updated");
    expect(() => readStripeEvent(Buffer.from(payload), `t=${timestamp},v1=${"0".repeat(signature.length)}`, secret)).toThrow(/Invalid Stripe signature/);
  });
});
