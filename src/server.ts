import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApp, defaultDeps } from "./app.js";
import { createDepositMcpServer } from "./deposit-tools.js";
import { useStdioTransport } from "./transport.js";

const deps = defaultDeps();
export const app = createApp(deps);
export default app;
export { useStdioTransport };

const port = Number(process.env.PORT ?? 3000);
if (process.env.NODE_ENV !== "test") {
  // A terminal keeps the HTTP listener only. A pipe attaches stdin and speaks MCP there.
  const stdio = useStdioTransport(process.stdin.isTTY);
  app.listen(port, () => {
    const line = `Deposit listening on ${port}`;
    if (stdio) console.error(line);
    else console.log(line);
  });
  if (stdio) {
    const stdioServer = createDepositMcpServer({ userId: "", entitled: false, store: deps.store });
    await stdioServer.connect(new StdioServerTransport());
  }
}
