import { createHash } from "node:crypto";
import net from "node:net";

import { requestCandidateCaseHttp } from "./candidate-case-http.mjs";
import { deepwellRpcAuthorization } from "./deepwell-rpc-auth.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
} from "./standing-browser-parity-util.mjs";

const ACTORS = Object.freeze(["administrator", "non_admin", "expired"]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function loopbackRpcUrl(value) {
  const url = new URL(requireNonEmptyString(value, "private input deepwell_rpc_url"));
  const address = url.hostname.replace(/^\[(.*)\]$/u, "$1");
  const family = net.isIP(address);
  if (
    url.protocol !== "http:" ||
    url.pathname !== "/jsonrpc" ||
    url.search ||
    url.hash ||
    !url.port ||
    !((family === 4 && address.startsWith("127.")) || (family === 6 && address === "::1"))
  ) {
    throw new Error("private input deepwell_rpc_url must be one loopback HTTP JSON-RPC endpoint");
  }
  return { url, address };
}

function actor(value, name) {
  const input = requirePlainObject(value, `private input ${name} actor`);
  if (
    !Number.isSafeInteger(input.user_id) ||
    typeof input.session_token !== "string" ||
    input.session_token.length === 0 ||
    /[\r\n]/u.test(input.session_token)
  ) {
    throw new Error(`private input ${name} actor is invalid`);
  }
  return { userId: input.user_id, sessionToken: input.session_token };
}

function fixtureIdentity(value) {
  const input = requirePlainObject(value, "private input fixture identity");
  const category = (name) => {
    const row = requirePlainObject(input[name], `private input fixture ${name}`);
    if (!Number.isSafeInteger(row.category_id) || !Number.isSafeInteger(row.page_id) || typeof row.slug !== "string" || !row.slug || typeof row.page_slug !== "string" || !row.page_slug) throw new Error(`private input fixture ${name} is invalid`);
    return { category_id: row.category_id, slug: row.slug, page_id: row.page_id, page_slug: row.page_slug };
  };
  if (!Number.isSafeInteger(input.site_id) || !Number.isSafeInteger(input.cross_site_sentinel_id) || input.cross_site_sentinel_id <= 0 || input.cross_site_sentinel_id === input.site_id) throw new Error("private input fixture site identity is invalid");
  const result = { site_id: input.site_id, cross_site_sentinel_id: input.cross_site_sentinel_id, default_category: category("default_category"), transition_category: category("transition_category") };
  if (result.default_category.category_id === result.transition_category.category_id || result.default_category.slug === result.transition_category.slug || result.default_category.page_slug === result.transition_category.page_slug) throw new Error("private input fixture categories must be distinct");
  return Object.freeze(result);
}

export class Open43SettingsCandidateSession {
  #candidate;
  #rpc;
  #rpcAuthorization;
  #rpcToken;
  #tlsCa;
  #actors;
  #fixture;
  #request;
  #signal;
  #rpcId = 1;

  constructor({ candidateIdentity, privateInput: rawInput, requestImpl = requestCandidateCaseHttp, signal = null }) {
    const input = requirePlainObject(rawInput, "private Open43 settings input");
    this.#candidate = candidateIdentity;
    this.#rpc = loopbackRpcUrl(input.deepwell_rpc_url);
    this.#rpcToken = requireNonEmptyString(input.deepwell_rpc_token, "private input deepwell_rpc_token");
    this.#rpcAuthorization = deepwellRpcAuthorization(this.#rpcToken);
    this.#tlsCa = requireNonEmptyString(input.tls_ca_pem, "private input tls_ca_pem");
    this.#actors = Object.fromEntries(
      ACTORS.map((name) => [name, actor(input.actors?.[name], name)]),
    );
    this.#fixture = fixtureIdentity(input.fixture);
    this.#request = requestImpl;
    this.#signal = signal;
  }

  get fixtureIdentity() { return this.#fixture; }
  get pageOrigin() { return candidatePageOrigin(this.#candidate); }
  get privateInputIdentity() {
    return {
      deepwell_rpc_url: this.#rpc.url.href,
      deepwell_rpc_token_sha256: sha256(this.#rpcToken),
      tls_ca_sha256: sha256(this.#tlsCa),
      fixture_identity_sha256: sha256(JSON.stringify(this.#fixture)),
      ...Object.fromEntries(ACTORS.flatMap((name) => [
        [`${name}_user_id`, this.#actors[name].userId],
        [`${name}_session_sha256`, sha256(this.#actors[name].sessionToken)],
      ])),
    };
  }
  get requiredServiceBindings() {
    return [{ role: "deepwell", container_port: "2747/tcp", host_address: this.#rpc.address, host_port: Number(this.#rpc.url.port) }];
  }

  storageState(name) {
    if (name === "anonymous") return { cookies: [], origins: [] };
    const selected = this.#actors[name];
    if (!selected) throw new Error(`unknown settings browser actor: ${name}`);
    return {
      cookies: [{ name: "wikijump_token", value: selected.sessionToken, url: this.pageOrigin, httpOnly: true, secure: true, sameSite: "Lax" }],
      origins: [],
    };
  }

  async rpc(method, params = {}, { actor: actorName = "administrator", siteId, page, cleanup = false } = {}) {
    const selected = actorName === "anonymous" ? null : this.#actors[actorName];
    if (actorName !== "anonymous" && !selected) throw new Error(`unknown settings RPC actor: ${actorName}`);
    const response = await this.#request({
      url: this.#rpc.url,
      method: "POST",
      headers: {
        authorization: this.#rpcAuthorization,
        "content-type": "application/json",
        ...(selected ? { "x-deepwell-session-token": selected.sessionToken } : {}),
        ...(siteId === undefined ? {} : { "x-deepwell-site-id": siteId }),
        ...(page === undefined ? {} : { "x-deepwell-page": page }),
      },
      body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: this.#rpcId++, method, params })),
      signal: cleanup ? null : this.#signal,
    });
    let payload;
    try { payload = JSON.parse(response.body); } catch { throw new Error(`${method} returned non-JSON at the public Deepwell seam`); }
    if (response.status !== 200 || payload?.error !== undefined) throw new Error(`${method} failed at the public Deepwell seam`);
    return payload.result;
  }

  async action(name, fields, { actor: actorName = "administrator", origin = this.pageOrigin, cleanup = false } = {}) {
    const selected = actorName === "anonymous" ? null : this.#actors[actorName];
    if (actorName !== "anonymous" && !selected) throw new Error(`unknown settings action actor: ${actorName}`);
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(fields)) body.set(key, String(value));
    const bytes = Buffer.from(body.toString());
    const response = await this.#request({
      url: new URL(`/_admin?/${encodeURIComponent(name)}`, this.pageOrigin),
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(bytes.length),
        "x-sveltekit-action": "true",
        origin,
        ...(selected ? { cookie: `wikijump_token=${selected.sessionToken}` } : {}),
      },
      body: bytes,
      connectAddress: this.#candidate.candidate.endpoint.local_connect_address,
      tlsCa: this.#tlsCa,
      signal: cleanup ? null : this.#signal,
    });
    return {
      http_status: response.status,
      content_type: response.headers["content-type"] ?? null,
      response_body_sha256: sha256(response.body),
    };
  }
}
