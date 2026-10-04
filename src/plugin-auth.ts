import type { Express } from "express";
import { canonicalPublicOrigin } from "./public-url.js";

/** OAuth resource stays on the configured base. Clients discover the issuer from this document. */
export function protectedResourceMetadata(baseUrl: string, supabaseUrl: string) {
  const origin = canonicalPublicOrigin(baseUrl);
  const issuer = supabaseUrl ? `${supabaseUrl.replace(/\/+$/, "")}/auth/v1` : "";
  return {
    resource: `${origin}/mcp`,
    resource_name: "Deposit",
    authorization_servers: issuer ? [issuer] : [],
    scopes_supported: ["email", "offline_access"],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/connect`
  };
}

export function installPluginAuth(app: Express, baseUrl: string, supabaseUrl: string, anonKey: string) {
  const metadata = protectedResourceMetadata(baseUrl, supabaseUrl);
  app.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*").json(metadata);
  });
  app.get(["/oauth/consent", "/connections"], (_req, res) => {
    const config = JSON.stringify({ supabaseUrl, anonKey }).replace(/</g, "\\u003c");
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Deposit</title>
<style>body{margin:0;background:#1c1712;color:#f4efe6;font:17px/1.6 system-ui}main{max-width:560px;margin:8vh auto;padding:28px}a{color:#e0c59a}button{font:inherit;padding:12px 16px;border-radius:10px;border:0;background:#8d5a32;color:#fff;cursor:pointer;margin:8px 8px 8px 0}button.secondary{background:transparent;border:1px solid #a89070}section{border:1px solid #3d342c;border-radius:16px;padding:20px;margin:16px 0}label{display:block;margin:12px 0}input{box-sizing:border-box;width:100%;padding:10px;font:inherit;border:1px solid #a89070;border-radius:8px;background:#120e0b;color:inherit}[hidden]{display:none!important}#error{color:#ffb4b4}</style>
</head><body><main><a href="/">Deposit</a><h1 id="heading">Connect your approved deposit schedule</h1>
<p>Sign in with your Deposit account. Do not paste an API key or password into an MCP header.</p>
<p id="status" role="status">Checking your sign-in…</p><p id="error" role="alert"></p>
<button id="signout" class="secondary" hidden type="button">Use a different account</button>
<button id="signin" hidden type="button">Continue with Google</button>
<details id="passwordLogin" hidden><summary>Sign in with email and password</summary>
<form id="passwordForm"><label>Email<input id="loginEmail" type="email" required autocomplete="username"></label><label>Password<input id="loginPassword" type="password" required autocomplete="current-password"></label><button>Sign in</button></form>
<p>This form signs in on this page. It is not a header and it is not an API key.</p></details>
<section id="consent" hidden><h2 id="client"></h2><p>This application will be able to:</p>
<ul><li>Read your approved deposit, later payment dates, and what an assistant may tell the client.</li><li>Update them when you approve, including schedule changes you explicitly accept.</li><li>Read your account email and subscription status.</li></ul>
<p>Your Pro or trial subscription still applies. The tools refuse waiving the deposit, marking it paid, and moving a payment date unless you accept that change. Billing changes are not available through the tools.</p>
<p id="destination"></p><p id="scopes"></p>
<button id="approve" type="button">Connect</button><button id="deny" class="secondary" type="button">Cancel</button></section>
<section id="connections" hidden><p>You can disconnect an application at any time.</p><div id="grants"></div></section>
<p><a href="/connections">Manage connected applications</a></p></main>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/dist/umd/supabase.js"></script>
<script>
(async function(){
var cfg=${config}, id=new URLSearchParams(location.search).get("authorization_id");
function el(name){return document.getElementById(name)}
function fail(error){el("status").textContent="";el("error").textContent=error.message||String(error)}
try{
 if(!cfg.supabaseUrl||!cfg.anonKey) throw new Error("OAuth is not configured on this server.");
 if(!window.supabase) throw new Error("Sign-in could not load. Refresh to try again.");
 var client=window.supabase.createClient(cfg.supabaseUrl,cfg.anonKey);
 var result=await client.auth.getSession();if(result.error) throw result.error;
 el("passwordForm").onsubmit=async function(event){event.preventDefault();var button=this.querySelector("button");button.disabled=true;try{var signed=await client.auth.signInWithPassword({email:el("loginEmail").value,password:el("loginPassword").value});el("loginPassword").value="";if(signed.error) throw new Error("Email sign-in failed. Check the account and try again.");location.reload()}catch(error){fail(error);button.disabled=false}};
 el("signin").onclick=async function(){
   el("signin").disabled=true;
   try{sessionStorage.setItem("depositPluginReturn",JSON.stringify({id:id,createdAt:Date.now()}));var oauth=await client.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin+"/"}});if(oauth.error) throw oauth.error}
   catch(error){fail(error);el("signin").disabled=false}
 };
 if(!result.data.session){el("status").textContent="Sign in to choose which application can read your approved deposit schedule.";el("signin").hidden=false;el("passwordLogin").hidden=false;return}
 el("status").textContent="Signed in as "+(result.data.session.user.email||"your account");
 el("signout").hidden=false;
 el("signout").onclick=async function(){this.disabled=true;try{var out=await client.auth.signOut({scope:"local"});if(out.error) throw out.error;location.reload()}catch(error){fail(error);this.disabled=false}};
 if(location.pathname==="/connections"){
   el("heading").textContent="Connected applications";el("connections").hidden=false;
   var grants=await client.auth.oauth.listGrants();if(grants.error) throw grants.error;
   var rows=Array.isArray(grants.data)?grants.data:(grants.data&&grants.data.grants)||[];
   if(!rows.length) el("grants").textContent="No applications are connected.";
   rows.forEach(function(grant){var row=document.createElement("div");var title=document.createElement("p");title.textContent=grant.client.name||grant.client.id;row.appendChild(title);var button=document.createElement("button");button.textContent="Disconnect";row.appendChild(button);button.onclick=async function(){button.disabled=true;try{var revoked=await client.auth.oauth.revokeGrant({clientId:grant.client.id});if(revoked.error) throw revoked.error;row.remove()}catch(error){fail(error);button.disabled=false}};el("grants").appendChild(row)});
   return;
 }
 if(!id) throw new Error("Open Deposit from your assistant to start a new authorization request.");
 var details=await client.auth.oauth.getAuthorizationDetails(id);if(details.error) throw details.error;
 if(details.data.redirect_url){location.assign(details.data.redirect_url);return}
 el("client").textContent="Connect "+(details.data.client.name||"this application")+"?";
 el("destination").textContent="Return address: "+details.data.redirect_uri;
 el("scopes").textContent="Requested scopes: "+details.data.scope;
 el("consent").hidden=false;
 async function decide(approved){el("approve").disabled=true;el("deny").disabled=true;try{var decision=await client.auth.oauth[approved?"approveAuthorization":"denyAuthorization"](id,{skipBrowserRedirect:true});if(decision.error) throw decision.error;location.assign(decision.data.redirect_url)}catch(error){fail(error);el("approve").disabled=false;el("deny").disabled=false}}
 el("approve").onclick=function(){decide(true)};el("deny").onclick=function(){decide(false)};
}catch(error){fail(error)}
})();
</script></body></html>`);
  });
}
