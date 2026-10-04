import { describe, expect, it } from "vitest";
import { validateMcpClaims } from "../src/mcp-claims.js";

function token(payload: Record<string, unknown>): string {
  return `aaa.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.ccc`;
}

const issuer = "https://example.supabase.co/auth/v1";
const resource = "http://127.0.0.1:3000/mcp";

describe("MCP claims", () => {
  it("accepts an authenticated token for this resource", () => {
    const claims = validateMcpClaims(token({
      sub: "user-1",
      iss: issuer,
      aud: resource,
      role: "authenticated",
      exp: 2_000,
      client_id: "client",
      session_id: "session",
      scope: "email offline_access"
    }), "user-1", issuer, resource, 1_000);
    expect(claims.sub).toBe("user-1");
  });

  it("rejects a token that is not an OAuth client session", () => {
    expect(() => validateMcpClaims(token({
      sub: "user-1",
      iss: issuer,
      aud: resource,
      role: "authenticated",
      exp: 2_000,
      scope: "email"
    }), "user-1", issuer, resource, 1_000)).toThrow("Reconnect Deposit");
  });
});
