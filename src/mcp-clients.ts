import type { NextFunction, Request, Response } from "express";

/** Media types StreamableHTTPServerTransport requires as substrings of Accept. */
const STREAMABLE_HTTP_JSON = "application/json";
const STREAMABLE_HTTP_SSE = "text/event-stream";

/**
 * Return an Accept value that includes both media types the SDK checks for,
 * or undefined when the incoming header already lists both.
 * Clients often send only application/json, only text/event-stream, star, or nothing.
 */
export function completeStreamableHttpAccept(header: string | string[] | undefined): string | undefined {
  const current = (Array.isArray(header) ? header.join(", ") : header ?? "").trim();
  const hasJson = current.includes(STREAMABLE_HTTP_JSON);
  const hasSse = current.includes(STREAMABLE_HTTP_SSE);
  if (hasJson && hasSse) return undefined;
  const extras = [hasJson ? "" : STREAMABLE_HTTP_JSON, hasSse ? "" : STREAMABLE_HTTP_SSE].filter(Boolean);
  return current ? `${current}, ${extras.join(", ")}` : extras.join(", ");
}

/** Fill a missing or incomplete Accept header before the Streamable HTTP transport reads it. */
export function ensureStreamableHttpAccept(req: Request, _res: Response, next: NextFunction) {
  const completed = completeStreamableHttpAccept(req.headers.accept);
  if (completed !== undefined) req.headers.accept = completed;
  next();
}

/** Browser origins that may call /mcp. Clients that omit Origin are allowed. */
export const MCP_BROWSER_ORIGINS = [
  "https://chatgpt.com",
  "https://chat.openai.com",
  "https://claude.ai",
  "https://gemini.google.com",
  "https://grok.com",
  "https://cursor.com",
  "https://www.cursor.com"
] as const;

export function mcpBrowserOriginAllowed(origin: string | undefined, appBaseUrl: string): boolean {
  if (!origin) return true;
  const base = appBaseUrl.replace(/\/$/, "");
  return origin === base || (MCP_BROWSER_ORIGINS as readonly string[]).includes(origin);
}

export const MCP_CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "600"
};
