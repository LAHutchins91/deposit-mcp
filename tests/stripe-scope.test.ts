import { describe, expect, it } from "vitest";
import { isOwnCheckout, isOwnSubscription, subscriptionPriceIds } from "../src/stripe-scope.js";

const BASE = "https://app.example.test";
const PRICES = ["price_own_month", "price_own_year"];

describe("shared Stripe account: only this app's events count", () => {
  it("accepts only checkouts that return to this app", () => {
    expect(isOwnCheckout({ success_url: `${BASE}/?checkout=success` }, BASE)).toBe(true);
    expect(isOwnCheckout({ success_url: `${BASE}/?checkout=success` }, `${BASE}/`)).toBe(true);
    expect(isOwnCheckout({ success_url: "https://other-app.vercel.app/?checkout=success" }, BASE)).toBe(false);
    expect(isOwnCheckout({ success_url: `${BASE}.evil.test/?checkout=success` }, BASE)).toBe(false);
    expect(isOwnCheckout({ success_url: `https://evil.test/?next=${BASE}/` }, BASE)).toBe(false);
    expect(isOwnCheckout({}, BASE)).toBe(false);
    expect(isOwnCheckout({ success_url: `${BASE}/` }, "")).toBe(false);
  });

  it("accepts only subscriptions whose every price is ours", () => {
    expect(isOwnSubscription({ items: { data: [{ price: { id: "price_own_month" } }] } }, PRICES)).toBe(true);
    expect(isOwnSubscription({ items: { data: [{ price: "price_own_year" }] } }, PRICES)).toBe(true);
    expect(isOwnSubscription({ items: { data: [{ price: { id: "price_fillip_month" } }] } }, PRICES)).toBe(false);
    expect(isOwnSubscription({ items: { data: [{ price: "price_own_month" }, { price: "price_other" }] } }, PRICES)).toBe(false);
    expect(isOwnSubscription({ items: { data: [] } }, PRICES)).toBe(false);
    expect(isOwnSubscription({}, PRICES)).toBe(false);
    expect(isOwnSubscription({ items: { data: [{ price: "price_own_month" }] } }, ["", " "])).toBe(false);
    expect(subscriptionPriceIds({ items: { data: [{ price: { id: "a" } }, { price: "b" }, {}] } })).toEqual(["a", "b", ""]);
  });
});
