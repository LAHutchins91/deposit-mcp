import { TRIAL_PERIOD_DAYS } from "./access.js";
import { canonicalPublicOrigin } from "./public-url.js";

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] ?? ch));
}

export function landingConnectLead(baseUrl: string): string {
  const origin = canonicalPublicOrigin(baseUrl);
  const mcp = htmlEscape(`${origin}/mcp`);
  const connect = htmlEscape(`${origin}/connect`);
  return `<p>MCP address: <code>${mcp}</code>. <a href="${connect}">Connect an assistant</a>.</p>`;
}

export function connectPageBody(baseUrl: string): string {
  const origin = canonicalPublicOrigin(baseUrl);
  const mcp = htmlEscape(`${origin}/mcp`);
  const metadata = htmlEscape(`${origin}/.well-known/oauth-protected-resource/mcp`);
  return `<p>Deposit keeps one approved freelance deposit and payment schedule for ChatGPT, Claude, Gemini, Grok, Cursor, and any other MCP client that speaks Streamable HTTP and OAuth. It is not a ChatGPT-only plugin. Deposit tools need Pro or an active trial. A new subscription includes a ${TRIAL_PERIOD_DAYS}-day trial.</p>
<section><h2>Shared connection</h2>
<p>MCP address:</p><p><code>${mcp}</code></p>
<p>Transport: Streamable HTTP. Sign in with your Deposit account when the assistant opens OAuth. Dynamic client registration is supported, so leave the client id and secret empty. Do not paste an API key, access token, or password into a header or into the chat.</p>
<p>An unauthenticated tool call returns <code>401</code> with a <code>WWW-Authenticate</code> challenge pointing at <code>${metadata}</code>. That document names the OAuth issuer. The issuer registers clients. Ask for the <code>email</code> scope, and <code>offline_access</code> when the client can refresh tokens.</p>
<ol><li><a href="/">Sign in</a> and start a trial if you have not already.</li><li>Add the MCP address using the steps below.</li><li>Approve Deposit, then ask the assistant to read the schedule before it answers.</li></ol>
</section>
<section><h2>ChatGPT</h2>
<ol><li>Enable custom MCP connectors if your workspace requires it.</li><li>Create a custom app and enter the MCP address.</li><li>Choose OAuth, leave client credentials empty, and approve Deposit.</li></ol>
</section>
<section><h2>Claude</h2>
<ol><li>Add a custom connector and paste the MCP address.</li><li>Choose OAuth and register the client automatically. Do not put a token in request headers.</li><li>Approve Deposit, then enable the connector in the chat.</li></ol>
<p>Claude Code:</p>
<pre><code>claude mcp add --transport http deposit ${mcp}</code></pre>
<p>Do not pass an Authorization header. In a JSON config, set <code>"type": "http"</code> next to <code>url</code>.</p>
</section>
<section><h2>Gemini</h2>
<ol><li>In the Gemini web app, open Settings, then Connected apps.</li><li>Add a custom app and paste the MCP address.</li><li>Leave advanced credentials empty. Deposit's authorization server registers the client.</li></ol>
<p>Gemini CLI:</p>
<pre><code>gemini mcp add --transport http --scope user deposit ${mcp}</code></pre>
<p>Do not set an Authorization header.</p>
</section>
<section><h2>Grok</h2>
<ol><li>Open grok.com/connectors.</li><li>Choose a custom connector and paste the MCP address.</li><li>Finish the sign-in Grok presents.</li></ol>
<pre><code>grok mcp add --transport http deposit ${mcp}</code></pre>
<p>Do not set an Authorization header. The xAI API's static bearer field is not a Deposit API key. Use a client that performs OAuth.</p>
</section>
<section><h2>Cursor and other MCP clients</h2>
<p>In <code>~/.cursor/mcp.json</code> or a project <code>.cursor/mcp.json</code>:</p>
<pre><code>{
  "mcpServers": {
    "deposit": {
      "url": "${mcp}"
    }
  }
}</code></pre>
<p>Do not add headers or a static client id. Cursor registers a client and opens sign-in. Any other client can use the same address when it supports Streamable HTTP, OAuth with PKCE, and dynamic client registration. Clients that call from their own servers should omit a browser Origin. Browser calls are accepted only from Deposit and the assistant sites on the server allowlist.</p>
</section>
<section><h2>After it connects</h2>
<p>Ask the assistant to call <code>read_schedule</code> before it talks about the deposit, later payment dates, or what it may tell the client. Waiving the deposit, marking it paid, and moving a payment date need an accepted schedule change. If a tool refuses, the assistant must stop rather than invent a workaround.</p>
<p>When you run this server yourself, the address above is the configured base URL. This repository does not publish a separate production domain.</p>
</section>`;
}
