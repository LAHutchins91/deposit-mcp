// Call only after the authorization server has verified the token signature.
export function validateMcpClaims(
  token: string,
  userId: string,
  issuer: string,
  resource: string,
  now = Date.now() / 1000
) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid connection");
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Invalid connection");
  }
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const scope = typeof claims.scope === "string" ? claims.scope.split(" ") : [];
  if (
    claims.sub !== userId ||
    claims.iss !== issuer ||
    !audience.includes(resource) ||
    claims.role !== "authenticated" ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    typeof claims.client_id !== "string" ||
    claims.client_id.length === 0 ||
    typeof claims.session_id !== "string" ||
    claims.session_id.length === 0 ||
    !scope.includes("email")
  ) {
    throw new Error("Reconnect Deposit");
  }
  return claims;
}
