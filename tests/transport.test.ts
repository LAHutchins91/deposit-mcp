import { describe, expect, it } from "vitest";
import { useStdioTransport } from "../src/transport.js";

describe("transport switch", () => {
  it("uses stdio when stdin is not a terminal", () => {
    expect(useStdioTransport(undefined)).toBe(true);
    expect(useStdioTransport(false)).toBe(true);
    expect(useStdioTransport(true)).toBe(false);
  });
});
