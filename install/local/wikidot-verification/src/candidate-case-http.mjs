import { createHash, randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import net from "node:net";

import { deepwellRpcAuthorization } from "./deepwell-rpc-auth.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import { requireNonEmptyString, requirePlainObject } from "./standing-browser-parity-util.mjs";

const MAX_BODY = 20 * 1024 * 1024;
const TIMEOUT_MS = 300_000;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function loopback(value, name) {
  const address = String(value).replace(/^\[(.*)\]$/u, "$1");
  const family = net.isIP(address);
  if ((family === 4 && address.startsWith("127.")) || (family === 6 && address === "::1")) return address;
  throw new Error(`${name} must be an explicit loopback address`);
}

function localUrl(value, name, pathname = "/") {
  const url = new URL(requireNonEmptyString(value, name));
  if (url.protocol !== "http:" || url.username || url.password || url.pathname !== pathname || url.search || url.hash || !url.port) throw new Error(`${name} must be an exact loopback HTTP endpoint`);
  loopback(url.hostname, `${name} host`);
  return url;
}

export async function requestCandidateCaseHttp({ url, method, headers = {}, body = null, connectAddress = null, tlsCa = null, signal = null }) {
  const target = url instanceof URL ? url : new URL(url);
  const transport = target.protocol === "https:" ? https : target.protocol === "http:" ? http : null;
  if (!transport) throw new Error("candidate request must use HTTP or HTTPS");
  const requestHeaders = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value)]));
  if (body !== null && !Object.hasOwn(requestHeaders, "content-length")) requestHeaders["content-length"] = String(body.length);
  return await new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method,
      headers: requestHeaders,
      ...(target.protocol === "https:" ? { servername: target.hostname, ...(tlsCa === null ? {} : { ca: tlsCa }) } : {}),
      ...(connectAddress === null ? {} : {
        lookup(_hostname, options, callback) {
          const address = loopback(connectAddress, "candidate connect address");
          const family = net.isIP(address);
          callback(null, options?.all ? [{ address, family }] : address, options?.all ? undefined : family);
        },
      }),
      signal,
    });
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error(`candidate request timed out after ${TIMEOUT_MS}ms`)));
    request.once("error", reject);
    request.once("response", (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) response.destroy(new Error(`candidate response exceeded ${MAX_BODY} bytes`));
        else chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.end(body);
  });
}

function privateInput(value) {
  const input = requirePlainObject(value, "private candidate case input");
  const deepwellRpcUrl = localUrl(input.deepwell_rpc_url, "private input deepwell_rpc_url", "/jsonrpc");
  const objectStoreOrigin = localUrl(input.object_store_origin, "private input object_store_origin");
  const presigned = new URL(requireNonEmptyString(input.presigned_origin, "private input presigned_origin"));
  if (presigned.protocol !== "http:" || presigned.username || presigned.password || presigned.pathname !== "/" || presigned.search || presigned.hash) throw new Error("private input presigned_origin must be one exact HTTP origin");
  const actor = requirePlainObject(input.actors?.editor, "private input editor actor");
  if (!Number.isSafeInteger(actor.user_id) || typeof actor.session_token !== "string" || actor.session_token.length === 0 || /[\r\n]/u.test(actor.session_token)) throw new Error("private input editor actor is invalid");
  const rpcToken = requireNonEmptyString(input.deepwell_rpc_token, "private input deepwell_rpc_token");
  return {
    deepwellRpcUrl,
    rpcAuthorization: deepwellRpcAuthorization(rpcToken),
    rpcToken,
    objectStoreOrigin,
    presignedOrigin: presigned.origin,
    actor: { userId: actor.user_id, sessionToken: actor.session_token },
    tlsCa: requireNonEmptyString(input.tls_ca_pem, "private input tls_ca_pem"),
  };
}

function multipart(fields, file) {
  const boundary = `wikijump-candidate-${randomUUID()}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`), Buffer.from(file.bytes), Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function publicResponse(response) {
  return {
    status: response.status,
    content_type: response.headers["content-type"] ?? null,
    etag: response.headers.etag ?? null,
    content_length: response.headers["content-length"] ?? null,
    body_size: response.body.length,
    body_sha256: sha256(response.body),
    body_base64: response.body.toString("base64"),
  };
}

export class CandidateHttpSession {
  #candidate;
  #input;
  #request;
  #signal;
  #rpcId = 1;
  #events = [];

  constructor({ candidateIdentity, privateInput: rawInput, signal = null, requestImpl = requestCandidateCaseHttp }) {
    this.#candidate = candidateIdentity;
    this.#input = privateInput(rawInput);
    this.#request = requestImpl;
    this.#signal = signal;
  }

  get editorUserId() { return this.#input.actor.userId; }
  get editorSessionToken() { return this.#input.actor.sessionToken; }
  get pageOrigin() { return candidatePageOrigin(this.#candidate); }
  get privateInputIdentity() {
    return {
      deepwell_rpc_url: this.#input.deepwellRpcUrl.href,
      object_store_origin: this.#input.objectStoreOrigin.origin,
      presigned_origin: this.#input.presignedOrigin,
      editor_user_id: this.#input.actor.userId,
      deepwell_rpc_token_sha256: sha256(this.#input.rpcToken),
      editor_session_sha256: sha256(this.#input.actor.sessionToken),
      tls_ca_sha256: sha256(this.#input.tlsCa),
    };
  }
  get requiredServiceBindings() {
    return [
      { role: "deepwell", container_port: "2747/tcp", host_address: loopback(this.#input.deepwellRpcUrl.hostname, "Deepwell host"), host_port: Number(this.#input.deepwellRpcUrl.port) },
      { role: "files", container_port: "9000/tcp", host_address: loopback(this.#input.objectStoreOrigin.hostname, "object-store host"), host_port: Number(this.#input.objectStoreOrigin.port) },
    ];
  }
  get filesOrigin() {
    const origin = this.#candidate.candidate.endpoint.allowed_origin_set.find((value) => new URL(value).hostname.endsWith(".wjfiles.localhost"));
    if (!origin) throw new Error("sealed candidate identity has no files origin");
    return origin;
  }
  get events() { return structuredClone(this.#events); }

  #requestSignal(cleanup) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    return cleanup || this.#signal === null ? timeout : AbortSignal.any([this.#signal, timeout]);
  }

  async #send(service, operation, options, cleanup = false) {
    const response = await this.#request({ ...options, signal: this.#requestSignal(cleanup) });
    this.#events.push({ sequence: this.#events.length + 1, service, operation, method: options.method, response_status: response.status });
    return response;
  }

  async rpc(method, params = {}, { actor = "editor", siteId, page, cleanup = false } = {}) {
    if (!["editor", "anonymous"].includes(actor)) throw new Error("candidate RPC actor is invalid");
    const response = await this.#send("deepwell", method, {
      url: this.#input.deepwellRpcUrl,
      method: "POST",
      headers: {
        authorization: this.#input.rpcAuthorization,
        "content-type": "application/json",
        ...(actor === "editor" ? { "x-deepwell-session-token": this.#input.actor.sessionToken } : {}),
        ...(siteId === undefined ? {} : { "x-deepwell-site-id": siteId }),
        ...(page === undefined ? {} : { "x-deepwell-page": page }),
      },
      body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: this.#rpcId++, method, params })),
    }, cleanup);
    let payload;
    try { payload = JSON.parse(response.body); } catch { throw new Error(`${method} returned non-JSON at the public Deepwell seam`); }
    if (response.status !== 200) throw new Error(`${method} failed at the public Deepwell seam`);
    if (payload?.error !== undefined) {
      const error = new Error(`${method} failed at the public Deepwell seam`);
      error.rpc = {
        code: Number.isSafeInteger(payload.error?.code) ? payload.error.code : null,
        message_sha256: typeof payload.error?.message === "string" ? sha256(payload.error.message) : null,
      };
      throw error;
    }
    return payload.result;
  }

  async ajaxModuleConnector(fields, { actor = "editor", cleanup = false } = {}) {
    if (!["editor", "anonymous"].includes(actor)) throw new Error("candidate AMC actor is invalid");
    const body = Buffer.from(new URLSearchParams(fields).toString());
    const response = await this.#send("framerail", "ajax-module-connector", {
      url: new URL("/ajax-module-connector.php", this.pageOrigin),
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        origin: this.pageOrigin,
        ...(actor === "editor" ? { cookie: `wikijump_token=${this.#input.actor.sessionToken}` } : {}),
      },
      body,
      connectAddress: this.#candidate.candidate.endpoint.local_connect_address,
      tlsCa: this.#input.tlsCa,
    }, cleanup);
    let json;
    try {
      json = JSON.parse(response.body.toString("utf8"));
    } catch {
      throw new Error("ajax-module-connector.php returned non-JSON at the public seam");
    }
    return {
      http_status: response.status,
      content_type: response.headers["content-type"] ?? null,
      response_body_sha256: sha256(response.body),
      json,
    };
  }

  async filesRequest(pathname, { method = "GET", actor = "editor", cleanup = false, operation = pathname } = {}) {
    const url = new URL(pathname, this.filesOrigin);
    if (url.origin !== this.filesOrigin) throw new Error("file request escaped the sealed origin");
    return publicResponse(await this.#send("wws", operation, {
      url,
      method,
      headers: actor === "editor" ? { cookie: `wikijump_token=${this.#input.actor.sessionToken}` } : {},
      connectAddress: this.#candidate.candidate.endpoint.local_connect_address,
      tlsCa: this.#input.tlsCa,
    }, cleanup));
  }

  async pageRequest(pageSlug, { method = "GET", actor = "anonymous", cleanup = false, operation = `page-${method.toLowerCase()}` } = {}) {
    const url = new URL(`/${encodeURIComponent(pageSlug)}`, this.pageOrigin);
    return publicResponse(await this.#send("framerail", operation, {
      url,
      method,
      headers: actor === "editor" ? { cookie: `wikijump_token=${this.#input.actor.sessionToken}` } : {},
      connectAddress: this.#candidate.candidate.endpoint.local_connect_address,
      tlsCa: this.#input.tlsCa,
    }, cleanup));
  }

  async pageRouteRequest(pathname, { method = "GET", actor = "anonymous", cleanup = false, operation = `route-${method.toLowerCase()}` } = {}) {
    if (typeof pathname !== "string" || !pathname.startsWith("/")) throw new Error("candidate page route must be an absolute path");
    const url = new URL(pathname, this.pageOrigin);
    if (url.origin !== this.pageOrigin || url.pathname !== pathname || url.search || url.hash) throw new Error("candidate page route escaped the sealed origin or included a query or fragment");
    return publicResponse(await this.#send("framerail", operation, {
      url,
      method,
      headers: actor === "editor" ? { cookie: `wikijump_token=${this.#input.actor.sessionToken}` } : {},
      connectAddress: this.#candidate.candidate.endpoint.local_connect_address,
      tlsCa: this.#input.tlsCa,
    }, cleanup));
  }

  async multipartFileAction(pageSlug, fields, file, { actor = "editor", cleanup = false } = {}) {
    const data = multipart(fields, file);
    const url = new URL(`/${encodeURIComponent(pageSlug)}?/fileUpload`, this.pageOrigin);
    const response = await this.#send("framerail", "fileUpload", {
      url,
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": data.contentType,
        "x-sveltekit-action": "true",
        origin: this.pageOrigin,
        ...(actor === "editor" ? { cookie: `wikijump_token=${this.#input.actor.sessionToken}` } : {}),
      },
      body: data.body,
      connectAddress: this.#candidate.candidate.endpoint.local_connect_address,
      tlsCa: this.#input.tlsCa,
    }, cleanup);
    return { http_status: response.status, content_type: response.headers["content-type"] ?? null, response_body: response.body.toString("utf8"), response_body_sha256: sha256(response.body) };
  }

  async ajaxModuleRequest(fields, { actor = "anonymous", page, cleanup = false } = {}) {
    const body = Buffer.from(new URLSearchParams(fields).toString());
    const response = await this.#send("framerail", "ajax-module-connector", {
      url: new URL("/ajax-module-connector.php", this.pageOrigin),
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        origin: this.pageOrigin,
        ...(page === undefined ? {} : { referer: new URL(`/${encodeURIComponent(page)}`, this.pageOrigin).href }),
        ...(actor === "editor" ? { cookie: `wikijump_token=${this.#input.actor.sessionToken}` } : {}),
      },
      body,
      connectAddress: this.#candidate.candidate.endpoint.local_connect_address,
      tlsCa: this.#input.tlsCa,
    }, cleanup);
    const responseBody = response.body.toString("utf8");
    let payload;
    try {
      payload = JSON.parse(responseBody);
    } catch {
      throw new Error("AJAX Module Connector returned non-JSON at the public Framerail seam");
    }
    return {
      http_status: response.status,
      response_body_size: response.body.length,
      response_body_sha256: sha256(response.body),
      payload,
    };
  }

  async presignedPut(value, bytes, { cleanup = false } = {}) {
    const presigned = new URL(value);
    if (presigned.origin !== this.#input.presignedOrigin) throw new Error("blob_upload returned a URL outside the sealed object-store origin");
    const url = new URL(`${presigned.pathname}${presigned.search}`, this.#input.objectStoreOrigin);
    const response = await this.#send("object-store", "presigned_put", { url, method: "PUT", headers: { host: presigned.host }, body: Buffer.from(bytes) }, cleanup);
    if (response.status < 200 || response.status >= 300) throw new Error(`presigned PUT returned HTTP ${response.status}`);
    return { status: response.status, body_size: response.body.length };
  }
}
