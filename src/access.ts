/** New subscriptions start with this trial, then Pro. Not a price. */
export const TRIAL_PERIOD_DAYS = 14;

export const SIGN_IN_REQUIRED = "Sign in to Deposit to use deposit tools.";

export const PRO_REQUIRED = "This Deposit account does not currently include access to Deposit tools. Check that you connected the intended account.";

export const PUBLIC_MCP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "tools/list",
  "ping"
]);

export function hasDepositAccess(status: string): boolean {
  return status === "active" || status === "trialing";
}
