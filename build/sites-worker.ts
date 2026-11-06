import { catalogGate } from '../lib/catalog-gate.mjs';
import handler from "vinext/server/fetch-handler";
import eBorderHTML from "../calculator/e-border.html?raw";
import historyHTML from "../calculator/border-history.html?raw";
import calculatorHTML from "../calculator/index.html?raw";
import calculationMethodsHTML from "../calculator/calculation-methods.html?raw";
import serviceWorker from "../calculator/sw.js?raw";
import { manifest, iconData } from "../calculator/offline-assets.mjs";
import githubMeterRelease from "../github-sync/release.generated.json";
import { borderApi } from "../lib/border-store.mjs";
import { pocochaTimeApi } from "../lib/pococha-clock.mjs";
import { recordVisit } from "../lib/visitor-stats.mjs";
import { contactApi, contactAttachmentApi, contactSessionApi } from "../lib/contact-store.mjs";
import {sealCalculatorHTML,pagePolicy} from "../lib/browser-security.mjs";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
const securedCalculatorHTML=sealCalculatorHTML(calculatorHTML);

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const gate = await catalogGate(request,env,'meter'); if(gate)return gate;
    const path = new URL(request.url).pathname;
    if (path === "/e-border.html" && (request.method === "GET" || request.method === "HEAD")) return new Response(request.method === "HEAD" ? null : eBorderHTML,{headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":pagePolicy(eBorderHTML),"Referrer-Policy":"no-referrer"}});
    if ((path === "/border-history" || path === "/border-history.html") && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(request.method === "HEAD" ? null : historyHTML, {headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":pagePolicy(historyHTML),"Referrer-Policy":"no-referrer"}});
    }
    if (path === "/api/pococha-time") return pocochaTimeApi(request);
    if (path === "/github-meter-release.json" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(request.method === "HEAD" ? null : JSON.stringify(githubMeterRelease), { headers: {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }});
    }
    if (path === "/api/visits") return recordVisit(request, env);
    if (/^\/api\/contact\/attachments\/[^/]+$/.test(path)) return contactAttachmentApi(request, env);
    if (/^\/api\/admin\/contact\/attachments\/[^/]+$/.test(path)) return contactAttachmentApi(request, env, true);
    if (path === "/api/contact") return new Response(JSON.stringify({error:"お問い合わせは公開ツール一覧ホームからお願いします。"}),{status:410,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
    if (path === "/api/admin/contact") return contactApi(request, env, true);
    if (path === "/api/admin/contact/session") return contactSessionApi(request, env);
    if (path === "/calculation-methods" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(request.method === "HEAD" ? null : calculationMethodsHTML, { headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy":pagePolicy(calculationMethodsHTML), "Referrer-Policy":"no-referrer"
      }});
    }
    if (path === "/" && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(request.method === "HEAD" ? null : securedCalculatorHTML.replace("<!-- sites-host-context -->", `<meta name="pococha-sites-origin" content="${new URL(request.url).origin}">`), { headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Pococha-App": "meter-offline-v1", "Content-Security-Policy":pagePolicy(securedCalculatorHTML), "Referrer-Policy":"no-referrer", "Permissions-Policy":"camera=(), microphone=(), geolocation=()"
      }});
    }
    if ((request.method === "GET" || request.method === "HEAD") && path === "/meter-sw.js") {
      return new Response(request.method === "HEAD" ? null : serviceWorker, { headers: {
        "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache",
        "Service-Worker-Allowed": "/", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; connect-src 'self'; script-src 'self'"
      }});
    }
    if ((request.method === "GET" || request.method === "HEAD") && path === "/meter.webmanifest") {
      return new Response(request.method === "HEAD" ? null : JSON.stringify(manifest), { headers: {
        "Content-Type": "application/manifest+json; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"
      }});
    }
    const iconSize = path.match(/^\/meter-icon-(180|192|512)\.png$/)?.[1];
    if (iconSize && (request.method === "GET" || request.method === "HEAD")) {
      const bytes = Uint8Array.from(atob(iconData[iconSize as keyof typeof iconData]), c => c.charCodeAt(0));
      return new Response(request.method === "HEAD" ? null : bytes, { headers: {
        "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff"
      }});
    }
    if (path === "/api/borders" || path === "/api/borders/refresh" || path === "/api/borders/source-urls") {
      if(request.method==='POST'&&new URL(request.url).origin!==(env.BORDER_WRITER_ORIGIN||'https://poco-meter.freefreelife2000.chatgpt.site'))return new Response(JSON.stringify({error:'Production writer origin required'}),{status:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
      return borderApi(request, env);
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    const response = runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
    if (path === "/admin" || path.startsWith("/admin/")) return Promise.resolve(response).then(async original => {
      const html=original.headers.get('Content-Type')?.startsWith('text/html')?await original.text():null;
      const result = new Response(html===null?original.body:html, original);
      result.headers.set("Cache-Control", "private, no-store");
      result.headers.set("X-Robots-Tag", "noindex, nofollow");
      result.headers.set("Vary", "Cookie, oai-authenticated-user-id, oai-authenticated-user-email");
      result.headers.set('Content-Security-Policy',pagePolicy(html||'',true));
      result.headers.set('X-Frame-Options','DENY');
      result.headers.set('X-Content-Type-Options','nosniff');
      result.headers.set('Referrer-Policy','no-referrer');
      result.headers.delete('Content-Length');result.headers.delete('Content-Encoding');
      return result;
    });
    return response;
  },
};
