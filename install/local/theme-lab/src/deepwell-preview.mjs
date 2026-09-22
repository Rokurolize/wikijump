// Minimal Deepwell JSON-RPC client for the direct preview loop.
//
// `wikidot_page_preview` renders a page source to body HTML + inline styles
// without creating a page revision, so an agent can iterate on wikitext the
// same way it iterates on CSS. `syntax_only: true` skips runtime lookups and is
// the fastest mode.

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function validateLocalRpcUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.pathname !== "/jsonrpc" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Deepwell RPC URL must be an uncredentialed loopback HTTP /jsonrpc endpoint");
  }
  return url.href;
}

export function createDeepwellPreviewClient({
  rpcUrl = "http://127.0.0.1:2747/jsonrpc",
  rpcToken = process.env.DEEPWELL_RPC_TOKEN,
  timeoutMs = 30_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof rpcToken !== "string" || !rpcToken) {
    throw new Error("Deepwell RPC token is required (set DEEPWELL_RPC_TOKEN or pass --rpc-token)");
  }
  if (typeof fetchImpl !== "function") throw new Error("fetch is required");
  const endpoint = validateLocalRpcUrl(rpcUrl);
  const authorization = `Bearer ${rpcToken}`;
  let nextId = 1;

  const call = async (method, params) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {authorization, "content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: nextId++, method, params}),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error(`Deepwell ${method} timed out after ${timeoutMs}ms`);
      throw new Error(`Deepwell ${method} transport failed: ${error.message}`);
    } finally {
      clearTimeout(timer);
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || body.error) {
      throw new Error(`Deepwell ${method} failed: ${body?.error?.message ?? `HTTP ${response.status}`}`);
    }
    return body.result;
  };

  return {
    call,
    async preview({siteId, title, wikitext, syntaxOnly = false}) {
      const result = await call("wikidot_page_preview", {
        site_id: siteId,
        title,
        wikitext,
        syntax_only: syntaxOnly,
      });
      if (typeof result?.body !== "string") throw new Error("Deepwell preview returned no body");
      return {
        body: result.body,
        styles: Array.isArray(result.styles) ? result.styles : [],
        legacy_actions: result.legacy_actions ?? [],
        membership_actions: result.membership_actions ?? [],
      };
    },
  };
}
