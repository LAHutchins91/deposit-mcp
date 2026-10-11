/**
 * Every app on the shared Stripe account receives every webhook event.
 * These checks decide whether an event is provably this app's before any profile is touched.
 */
type JsonObject = Record<string, unknown>;

/** Every price id on a subscription (items.data[].price as a string or an object). */
export function subscriptionPriceIds(object: JsonObject): string[] {
  const items = object.items && typeof object.items === "object" ? object.items as { data?: unknown } : {};
  const data = Array.isArray(items.data) ? items.data : [];
  return data.map((item) => {
    const price = item && typeof item === "object" ? (item as { price?: unknown }).price : undefined;
    if (typeof price === "string") return price;
    if (price && typeof price === "object" && typeof (price as { id?: unknown }).id === "string") return (price as { id: string }).id;
    return "";
  });
}

/** True only when every item on the subscription is one of this app's prices. */
export function isOwnSubscription(object: JsonObject, ownPrices: string[]): boolean {
  const allowed = ownPrices.map((price) => price.trim()).filter(Boolean);
  const prices = subscriptionPriceIds(object);
  return allowed.length > 0 && prices.length > 0 && prices.every((price) => allowed.includes(price));
}

/** True only when the Checkout Session returns to this app (success_url under APP_BASE_URL). */
export function isOwnCheckout(object: JsonObject, appBaseUrl: string): boolean {
  const base = appBaseUrl.replace(/\/+$/, "");
  const success = typeof object.success_url === "string" ? object.success_url : "";
  return Boolean(base) && (success === base || success.startsWith(`${base}/`) || success.startsWith(`${base}?`));
}
