import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import { readPrivateCandidateCaseInput } from "./candidate-case-command.mjs";
import { requestCandidateCaseHttp } from "./candidate-case-http.mjs";
import { deepwellRpcAuthorization } from "./deepwell-rpc-auth.mjs";
import {
  assertCandidateIdentityFresh,
  candidatePageOrigin,
  validateCandidateParityIdentity,
} from "./standing-browser-parity-receipt.mjs";
import {
  readJsonObject,
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sealJsonNoReplace,
  sha256File,
} from "./standing-browser-parity-util.mjs";

export const CANDIDATE_ACCOUNT_PROVISIONING_RECEIPT_SCHEMA = "wikijump.candidate_account_provisioning_receipt.v1";

const EDITABLE_SITE_SLUG = "scpaiueouiuiuiui";
const EDITABLE_SITE_HOST = `${EDITABLE_SITE_SLUG}.wikijump.localhost`;
const PLATFORM_STAFF_USER_ID = -1;
const OPTIONS = ["candidate-identity", "private-input", "receipt"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function candidateAccountProvisioningUsage() {
  return "Usage: provision-candidate-account.mjs --candidate-identity FILE --private-input PRIVATE.json --receipt RECEIPT.json";
}

export function parseCandidateAccountProvisioningArgs(argv) {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  if (values.includes("--help") || values.includes("-h")) return { help: true };
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    if (!OPTIONS.includes(name) || Object.hasOwn(args, name) || !value || value.startsWith("--")) throw new Error(`unknown or duplicate option: ${flag}\n${candidateAccountProvisioningUsage()}`);
    args[name] = value;
  }
  for (const name of OPTIONS) if (!args[name]) throw new Error(`missing --${name}\n${candidateAccountProvisioningUsage()}`);
  return args;
}

function exactCandidate(rawIdentity) {
  const endpoint = rawIdentity?.candidate?.endpoint;
  if (endpoint?.host !== EDITABLE_SITE_HOST || endpoint.port === 443 || rawIdentity?.candidate?.port_443_published !== false) throw new Error(`candidate account provisioning requires the exact non-standing editable candidate ${EDITABLE_SITE_HOST}`);
  return assertCandidateIdentityFresh(validateCandidateParityIdentity(rawIdentity));
}

function loopbackRpcUrl(value) {
  const url = new URL(requireNonEmptyString(value, "private input deepwell_rpc_url"));
  const address = url.hostname.replace(/^\[(.*)\]$/u, "$1");
  const family = net.isIP(address);
  if (url.protocol !== "http:" || url.pathname !== "/jsonrpc" || url.search || url.hash || !url.port || !((family === 4 && address.startsWith("127.")) || (family === 6 && address === "::1"))) throw new Error("private input deepwell_rpc_url must be one loopback HTTP JSON-RPC endpoint");
  return url;
}

function privateAccountInput(rawInput, candidateIdentitySha256) {
  const input = requirePlainObject(rawInput, "private candidate account provisioning input");
  const operator = requirePlainObject(input.operator, "private input operator");
  const account = requirePlainObject(input.account, "private input account");
  const userId = account.wikidot_user_id;
  const publicName = requireNonEmptyString(account.public_name, "private input account public_name");
  const publicSlug = requireNonEmptyString(account.public_slug, "private input account public_slug");
  const loginIdentifier = requireNonEmptyString(account.login_identifier, "private input account login_identifier");
  const password = requireNonEmptyString(account.password, "private input account password");
  if (requireSha256(input.candidate_identity_sha256, "private input candidate_identity_sha256") !== candidateIdentitySha256) throw new Error("private input is not sealed to the selected candidate identity");
  if (!Number.isSafeInteger(userId) || userId === PLATFORM_STAFF_USER_ID) throw new Error("candidate account provisioning requires a safe Wikidot user ID distinct from platform staff");
  if (operator.user_id !== PLATFORM_STAFF_USER_ID) throw new Error("private input operator must be the sealed platform staff actor");
  const operatorSession = requireNonEmptyString(operator.session_token, "private input operator session_token");
  if (/\r|\n/u.test(operatorSession)) throw new Error("private input operator session_token is invalid");
  if (loginIdentifier !== publicName && loginIdentifier !== publicSlug) throw new Error("private input login_identifier must match the exact Wikidot public name or slug");
  if (!Array.isArray(account.locales) || account.locales.length === 0 || account.locales.some((locale) => typeof locale !== "string" || locale === "") || new Set(account.locales).size !== account.locales.length) throw new Error("private input account locales must be a non-empty unique string array");
  const rpcToken = requireNonEmptyString(input.deepwell_rpc_token, "private input deepwell_rpc_token");
  const tlsCa = requireNonEmptyString(input.tls_ca_pem, "private input tls_ca_pem");
  return Object.freeze({
    rpcUrl: loopbackRpcUrl(input.deepwell_rpc_url),
    rpcToken,
    rpcAuthorization: deepwellRpcAuthorization(rpcToken),
    tlsCa,
    operator: Object.freeze({ userId: PLATFORM_STAFF_USER_ID, sessionToken: operatorSession }),
    account: Object.freeze({ userId, publicName, publicSlug, loginIdentifier, password, locales: Object.freeze([...account.locales]) }),
  });
}

function assertExactAccount(value, account, expectedType) {
  const user = requirePlainObject(value, "candidate account identity");
  if (user.user_id !== account.userId || user.user_type !== expectedType || user.name !== account.publicName || user.slug !== account.publicSlug) throw new Error("candidate account identity does not match the sealed Wikidot identity");
  return user;
}

function cookieValues(headers) {
  const value = headers["set-cookie"];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function sessionCookie(response) {
  for (const value of cookieValues(response.headers)) {
    const match = /(?:^|;\s*)wikijump_token=([^;]+)/u.exec(value);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

function actionResult(response, name) {
  let result;
  try {
    result = JSON.parse(response.body);
  } catch {
    throw new Error(`${name} did not return a serialized SvelteKit ActionResult`);
  }
  if (response.status !== 200 || !result || !["success", "failure"].includes(result.type) || !Number.isSafeInteger(result.status)) {
    throw new Error(`${name} did not return a serialized SvelteKit ActionResult`);
  }
  return result;
}

class CandidateAccountProvisioner {
  #candidate;
  #input;
  #request;
  #rpcId = 1;

  constructor({ candidateIdentity, privateInput, requestImpl }) {
    this.#candidate = candidateIdentity;
    this.#input = privateInput;
    this.#request = requestImpl;
  }

  async #rpc(method, params, { operator = false } = {}) {
    const response = await this.#request({
      url: this.#input.rpcUrl,
      method: "POST",
      headers: {
        authorization: this.#input.rpcAuthorization,
        "content-type": "application/json",
        ...(operator ? { "x-deepwell-session-token": this.#input.operator.sessionToken } : {}),
      },
      body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: this.#rpcId++, method, params })),
    });
    let payload;
    try { payload = JSON.parse(response.body); } catch { throw new Error(`${method} returned non-JSON at the candidate Deepwell seam`); }
    if (response.status !== 200 || payload?.error !== undefined) throw new Error(`${method} failed at the candidate Deepwell seam`);
    return payload.result;
  }

  async #verifyOperator() {
    const session = await this.#rpc("session_get", [this.#input.operator.sessionToken]);
    if (session?.user_id !== this.#input.operator.userId) throw new Error("sealed candidate operator session is not the platform staff actor");
  }

  async #activateAccount() {
    const account = this.#input.account;
    const before = await this.#rpc("user_get", { user: account.userId }, { operator: true });
    let activation;
    if (before?.user_type === "wikidot") {
      assertExactAccount(before, account, "wikidot");
      await this.#rpc("user_activate_from_wikidot", {
        user_id: account.userId,
        user_type: "regular",
        email: `candidate-wikidot-${account.userId}@example.invalid`,
        locales: [...account.locales],
        password: account.password,
        bypass_filter: true,
        bypass_email_verification: true,
        ip_address: "::1",
      }, { operator: true });
      activation = "activated_from_wikidot";
    } else {
      assertExactAccount(before, account, "regular");
      await this.#rpc("user_edit", {
        user: account.userId,
        password: account.password,
        ip_address: "::1",
      }, { operator: true });
      activation = "password_updated";
    }
    assertExactAccount(await this.#rpc("user_get", { user: account.userId }, { operator: true }), account, "regular");
    return activation;
  }

  async #ensureEditableSiteMembership() {
    const account = this.#input.account;
    const site = requirePlainObject(await this.#rpc("site_get", { site: EDITABLE_SITE_SLUG }, { operator: true }), "editable candidate site");
    if (!Number.isSafeInteger(site.site_id) || site.slug !== EDITABLE_SITE_SLUG) throw new Error("editable candidate site identity is missing or malformed");
    const parameters = { site_id: site.site_id, user_id: account.userId };
    let membership = await this.#rpc("member_get", parameters, { operator: true });
    let result = "existing";
    if (membership === null) {
      await this.#rpc("member_set", {
        ...parameters,
        metadata: { accepted: { cause: "accepted", user_id: this.#input.operator.userId } },
        created_by: this.#input.operator.userId,
      }, { operator: true });
      membership = await this.#rpc("member_get", parameters, { operator: true });
      result = "created";
    }
    if (membership?.from_id !== account.userId || membership.dest_id !== site.site_id) throw new Error("editable candidate membership identity is missing or malformed");
    return { siteId: site.site_id, result };
  }

  async #login(password) {
    const body = new URLSearchParams({ nameOrEmail: this.#input.account.loginIdentifier, password });
    const bytes = Buffer.from(body.toString());
    return await this.#request({
      url: new URL("/-/login", candidatePageOrigin(this.#candidate)),
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "content-length": String(bytes.length),
        "x-sveltekit-action": "true",
        origin: candidatePageOrigin(this.#candidate),
        "user-agent": "wikijump-candidate-account-provisioning",
      },
      body: bytes,
      connectAddress: this.#candidate.candidate.endpoint.local_connect_address,
      tlsCa: this.#input.tlsCa,
    });
  }

  async #verifyLoginContract() {
    const successful = await this.#login(this.#input.account.password);
    const successfulResult = actionResult(successful, "ordinary candidate login");
    const sessionToken = sessionCookie(successful);
    if (sessionToken === null) throw new Error("ordinary candidate login did not create a session");
    const sessionsToClose = [sessionToken];
    let session;
    let rejected;
    let operationError = null;
    try {
      if (successfulResult.type !== "success") throw new Error("ordinary candidate login did not create a session");
      session = await this.#rpc("session_get", [sessionToken]);
      if (session?.user_id !== this.#input.account.userId) throw new Error("ordinary candidate login session has the wrong user identity");
      rejected = await this.#login(`wrong-${randomUUID()}`);
      const rejectedResult = actionResult(rejected, "ordinary candidate wrong-password login");
      const rejectedSession = sessionCookie(rejected);
      if (rejectedSession !== null) sessionsToClose.push(rejectedSession);
      if (rejectedResult.type !== "failure" || rejectedSession !== null) throw new Error("ordinary candidate login accepted a different password");
      rejected.action_status = rejectedResult.status;
    } catch (error) {
      operationError = error;
    }
    let cleanupError = null;
    try {
      for (const token of new Set(sessionsToClose)) {
        await this.#rpc("logout", [token]);
        if (await this.#rpc("session_get", [token]) !== null) throw new Error("ordinary candidate login probe session was not logged out");
      }
    } catch (error) {
      cleanupError = error;
    }
    if (operationError !== null && cleanupError !== null) throw new AggregateError([operationError, cleanupError], "candidate login contract and session cleanup failed");
    if (operationError !== null) throw operationError;
    if (cleanupError !== null) throw cleanupError;
    return {
      correct_password_http_status: successful.status,
      correct_password_session_user_id: session.user_id,
      wrong_password_http_status: rejected.action_status,
      wrong_password_rejected: true,
      successful_probe_session_logged_out: true,
    };
  }

  async provision() {
    await this.#verifyOperator();
    const activation = await this.#activateAccount();
    const membership = await this.#ensureEditableSiteMembership();
    const loginContract = await this.#verifyLoginContract();
    return { activation, membership, loginContract };
  }
}

export async function runCandidateAccountProvisioningCommand(args, { requestImpl = requestCandidateCaseHttp, now = () => new Date().toISOString() } = {}) {
  const [rawIdentity, candidateIdentitySha256, privateFile] = await Promise.all([
    readJsonObject(args["candidate-identity"], "candidate identity"),
    sha256File(args["candidate-identity"]),
    readPrivateCandidateCaseInput(args["private-input"]),
  ]);
  const candidateIdentity = exactCandidate(rawIdentity);
  const input = privateAccountInput(privateFile.value, candidateIdentitySha256);
  const outcome = await new CandidateAccountProvisioner({ candidateIdentity, privateInput: input, requestImpl }).provision();
  const receipt = {
    schema: CANDIDATE_ACCOUNT_PROVISIONING_RECEIPT_SCHEMA,
    status: "pass",
    generated_at: now(),
    candidate_identity_sha256: candidateIdentitySha256,
    private_input_sha256: privateFile.sha256,
    account: {
      wikidot_user_id: input.account.userId,
      public_name: input.account.publicName,
      public_slug: input.account.publicSlug,
      login_identifier_sha256: sha256(input.account.loginIdentifier),
      activation: outcome.activation,
    },
    editable_site: {
      site_id: outcome.membership.siteId,
      slug: EDITABLE_SITE_SLUG,
      membership: outcome.membership.result,
    },
    login_contract: outcome.loginContract,
  };
  const receiptPath = path.resolve(args.receipt);
  await fs.mkdir(path.dirname(receiptPath), { recursive: true, mode: 0o700 });
  const publication = await sealJsonNoReplace(receiptPath, receipt);
  if (publication.publication !== "created") throw new Error(`candidate account provisioning receipt already exists: ${receiptPath}`);
  return { receipt: { path: receiptPath, sha256: publication.sha256 } };
}

export async function candidateAccountProvisioningMain(argv = process.argv.slice(2)) {
  const args = parseCandidateAccountProvisioningArgs(argv);
  if (args.help) return void process.stdout.write(`${candidateAccountProvisioningUsage()}\n`);
  process.stdout.write(`${JSON.stringify(await runCandidateAccountProvisioningCommand(args))}\n`);
}
