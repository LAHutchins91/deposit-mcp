/**
 * Stdio when stdin is not a terminal. A terminal keeps Streamable HTTP only.
 * `isTTY` is undefined when stdin is a pipe, which is not a terminal.
 */
export function useStdioTransport(isTTY: boolean | undefined): boolean {
  return isTTY !== true;
}
