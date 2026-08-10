import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseCandidateAccountProvisioningArgs,
  runCandidateAccountProvisioningCommand,
} from "../src/candidate-account-provisioning.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function candidateIdentity(host = "scpaiueouiuiuiui.wikijump.localhost", port = 18443) {
  const site = host.slice(0, -".wikijump.localhost".length);
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: {
      seal_sha256: hash("b"),
      verdict_sha256: hash("c"),
      final_images_sha256: hash("d"),
    },
    candidate: {
      owner: "candidate-account-provisioning-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-candidate-account-fixture",
      port_443_published: port === 443,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("e")}` },
      config: {
        isolated_overlay_sha256: hash("f"),
        promotion_base_manifest_sha256: hash("0"),
        effective_runtime_services_sha256: hash("4"),
      },
      endpoint: {
        scheme: "https",
        host,
        port,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [
          `https://${host}:${port}`,
          `https://${site}.wjfiles.localhost:${port}`,
        ].sort(),
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: {
      status: "sealed",
      manifest_sha256: hash("5"),
      seal_sha256: hash("6"),
    },
  };
}

function privateInput(userId = 123456) {
  return {
    deepwell_rpc_url: "http://127.0.0.1:2747/jsonrpc",
    deepwell_rpc_token: hash("7"),
    tls_ca_pem: "candidate-ca-secret",
    operator: {
      user_id: -1,
      session_token: "platform-staff-session-secret",
    },
    account: {
      wikidot_user_id: userId,
      public_name: "Account A",
      public_slug: "account-a",
      login_identifier: "Account A",
      password: "account-a-password-secret",
      locales: ["en"],
    },
  };
}

function response(status, body, headers = {}) {
  return {
    status,
    headers,
    body: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)),
  };
}

function requestFixture({ activated = false, member = false, userId = 123456, denyActivation = false } = {}) {
  const calls = [];
  let currentActivated = activated;
  let currentMember = member;
  let loginSessionActive = false;
  const requestImpl = async (request) => {
    const url = request.url instanceof URL ? request.url : new URL(request.url);
    if (url.pathname === "/jsonrpc") {
      const rpc = JSON.parse(request.body);
      const operatorMethod = ["user_activate_from_wikidot", "user_edit", "membership_set"].includes(rpc.method);
      if (operatorMethod) assert.equal(request.headers["x-deepwell-session-token"], "platform-staff-session-secret");
      calls.push({ kind: "rpc", method: rpc.method, params: rpc.params });
      let result;
      switch (rpc.method) {
        case "session_get": {
          const token = rpc.params[0];
          if (token === "platform-staff-session-secret") result = { user_id: -1 };
          else if (token === "candidate-login-session") result = loginSessionActive ? { user_id: userId } : null;
          else result = null;
          break;
        }
        case "user_get":
          result = {
            user_id: userId,
            user_type: currentActivated ? "regular" : "wikidot",
            name: "Account A",
            slug: "account-a",
            aliases: [],
          };
          break;
        case "user_activate_from_wikidot":
          assert.equal(rpc.params.user_id, userId);
          assert.equal(rpc.params.user_type, "regular");
          assert.equal(rpc.params.password, "account-a-password-secret");
          if (denyActivation) return response(200, { jsonrpc: "2.0", id: rpc.id, error: { code: 3100, message: "permission denied" } });
          currentActivated = true;
          result = { user_id: userId, user_type: "regular", name: "Account A", slug: "account-a" };
          break;
        case "user_edit":
          assert.deepEqual(rpc.params, {
            user: userId,
            password: "account-a-password-secret",
            ip_address: "::1",
          });
          result = { user_id: userId, user_type: "regular", name: "Account A", slug: "account-a" };
          break;
        case "site_get":
          assert.deepEqual(rpc.params, { site: "scpaiueouiuiuiui" });
          result = { site_id: 7654321, slug: "scpaiueouiuiuiui" };
          break;
        case "membership_get":
          result = currentMember ? { from_id: userId, dest_id: 7654321, relation_type: "site-member" } : null;
          break;
        case "membership_set":
          assert.equal(currentMember, false);
          currentMember = true;
          result = null;
          break;
        case "logout":
          assert.equal(rpc.params.length, 1);
          if (rpc.params[0] === "candidate-login-session") loginSessionActive = false;
          result = null;
          break;
        default:
          throw new Error(`unexpected RPC method ${rpc.method}`);
      }
      return response(200, { jsonrpc: "2.0", id: rpc.id, result });
    }

    assert.equal(url.pathname, "/-/login");
    assert.equal(request.method, "POST");
    assert.equal(request.headers["x-sveltekit-action"], "true");
    const form = new URLSearchParams(request.body.toString());
    assert.equal(form.get("nameOrEmail"), "Account A");
    const correct = form.get("password") === "account-a-password-secret";
    calls.push({ kind: "login", correct });
    if (correct) {
      loginSessionActive = true;
      return response(200, '{"type":"success","status":200}', {
        "content-type": "application/json",
        "set-cookie": ["wikijump_token=candidate-login-session; Path=/; HttpOnly; Secure; SameSite=Lax"],
      });
    }
    return response(500, '{"type":"failure","status":500}', {
      "content-type": "application/json",
    });
  };
  return { calls, requestImpl };
}

async function fixtureFiles(t, { identity = candidateIdentity(), input = privateInput() } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-account-provisioning-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identityPath = path.join(root, "candidate.json");
  const privatePath = path.join(root, "private.json");
  const receiptPath = path.join(root, "receipt.json");
  const identityBytes = `${JSON.stringify(identity)}\n`;
  const boundInput = {
    ...input,
    candidate_identity_sha256: input.candidate_identity_sha256 ?? sha256(identityBytes),
  };
  await fs.writeFile(identityPath, identityBytes);
  await fs.writeFile(privatePath, `${JSON.stringify(boundInput)}\n`, { mode: 0o600 });
  return { identityPath, privatePath, receiptPath };
}

test("candidate account provisioning activates the exact Wikidot identity and proves the ordinary login contract", async (t) => {
  const paths = await fixtureFiles(t);
  const fixture = requestFixture();
  const result = await runCandidateAccountProvisioningCommand({
    "candidate-identity": paths.identityPath,
    "private-input": paths.privatePath,
    receipt: paths.receiptPath,
  }, { requestImpl: fixture.requestImpl });

  assert.equal(result.receipt.path, paths.receiptPath);
  assert.match(result.receipt.sha256, /^[0-9a-f]{64}$/u);
  const receiptBytes = await fs.readFile(paths.receiptPath);
  assert.equal(sha256(receiptBytes), result.receipt.sha256);
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.account.wikidot_user_id, 123456);
  assert.equal(receipt.account.public_name, "Account A");
  assert.equal(receipt.account.public_slug, "account-a");
  assert.equal(receipt.account.activation, "activated_from_wikidot");
  assert.equal(receipt.editable_site.slug, "scpaiueouiuiuiui");
  assert.equal(receipt.editable_site.membership, "created");
  assert.deepEqual(receipt.login_contract, {
    correct_password_http_status: 200,
    correct_password_session_user_id: 123456,
    wrong_password_http_status: 500,
    wrong_password_rejected: true,
    successful_probe_session_logged_out: true,
  });
  const serialized = receiptBytes.toString("utf8");
  for (const secret of [
    "account-a-password-secret",
    "platform-staff-session-secret",
    hash("7"),
    "candidate-ca-secret",
    "candidate-login-session",
  ]) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(fixture.calls.some(({ method }) => method === "user_activate_from_wikidot"), true);
  assert.equal(fixture.calls.some(({ method }) => method === "membership_set"), true);
});

test("repeat provisioning verifies the same activated identity and changes only its local password", async (t) => {
  const paths = await fixtureFiles(t);
  const fixture = requestFixture({ activated: true, member: true });
  await runCandidateAccountProvisioningCommand({
    "candidate-identity": paths.identityPath,
    "private-input": paths.privatePath,
    receipt: paths.receiptPath,
  }, { requestImpl: fixture.requestImpl });
  const receipt = JSON.parse(await fs.readFile(paths.receiptPath));
  assert.equal(receipt.account.activation, "password_updated");
  assert.equal(receipt.editable_site.membership, "existing");
  assert.equal(fixture.calls.filter(({ method }) => method === "user_edit").length, 1);
  assert.equal(fixture.calls.some(({ method }) => method === "user_activate_from_wikidot"), false);
  assert.equal(fixture.calls.some(({ method }) => method === "membership_set"), false);
  assert.equal(fixture.calls.some(({ method }) => method?.includes("role")), false);
});

test("candidate account identity is authorized by the public imported record without assuming its sign", async (t) => {
  const userId = -20;
  const paths = await fixtureFiles(t, { input: privateInput(userId) });
  const fixture = requestFixture({ userId });
  await runCandidateAccountProvisioningCommand({
    "candidate-identity": paths.identityPath,
    "private-input": paths.privatePath,
    receipt: paths.receiptPath,
  }, { requestImpl: fixture.requestImpl });
  const receipt = JSON.parse(await fs.readFile(paths.receiptPath));
  assert.equal(receipt.account.wikidot_user_id, userId);
  assert.equal(receipt.account.activation, "activated_from_wikidot");
});

test("platform-staff rejection at the mutation seam aborts before membership or login", async (t) => {
  const paths = await fixtureFiles(t);
  const fixture = requestFixture({ denyActivation: true });
  await assert.rejects(runCandidateAccountProvisioningCommand({
    "candidate-identity": paths.identityPath,
    "private-input": paths.privatePath,
    receipt: paths.receiptPath,
  }, { requestImpl: fixture.requestImpl }), /user_activate_from_wikidot failed/u);
  assert.equal(fixture.calls.some(({ method }) => method === "membership_set"), false);
  assert.equal(fixture.calls.some(({ kind }) => kind === "login"), false);
  await assert.rejects(fs.access(paths.receiptPath));
});

test("a failed wrong-password probe still logs out the successful probe session", async (t) => {
  const paths = await fixtureFiles(t);
  const fixture = requestFixture();
  const requestImpl = async (request) => {
    const url = request.url instanceof URL ? request.url : new URL(request.url);
    if (url.pathname !== "/-/login") return await fixture.requestImpl(request);
    const form = new URLSearchParams(request.body.toString());
    if (form.get("password") === "account-a-password-secret") return await fixture.requestImpl(request);
    return response(200, '{"type":"success","status":200}', {
      "content-type": "application/json",
      "set-cookie": ["wikijump_token=unexpected-session; Path=/; HttpOnly; Secure; SameSite=Lax"],
    });
  };
  await assert.rejects(runCandidateAccountProvisioningCommand({
    "candidate-identity": paths.identityPath,
    "private-input": paths.privatePath,
    receipt: paths.receiptPath,
  }, { requestImpl }), /accepted a different password/u);
  assert.equal(fixture.calls.some(({ method }) => method === "logout"), true);
  await assert.rejects(fs.access(paths.receiptPath));
});

test("candidate account provisioning fails closed on identity, operator, and origin mismatches", async (t) => {
  const scenarios = [
    {
      name: "mirror candidate",
      identity: candidateIdentity("scp-wiki.wikijump.localhost"),
      input: privateInput(),
      pattern: /exact non-standing editable candidate/u,
    },
    {
      name: "standing port",
      identity: candidateIdentity("scpaiueouiuiuiui.wikijump.localhost", 443),
      input: privateInput(),
      pattern: /exact non-standing editable candidate/u,
    },
    {
      name: "Account A platform escalation",
      identity: candidateIdentity(),
      input: privateInput(-1),
      pattern: /distinct from platform staff/u,
    },
    {
      name: "private input bound to another candidate",
      identity: candidateIdentity(),
      input: { ...privateInput(), candidate_identity_sha256: hash("9") },
      pattern: /not sealed to the selected candidate identity/u,
    },
    {
      name: "non-platform operator",
      identity: candidateIdentity(),
      input: { ...privateInput(), operator: { user_id: 123456, session_token: "not-platform" } },
      pattern: /platform staff actor/u,
    },
    {
      name: "unverified platform operator session",
      identity: candidateIdentity(),
      input: { ...privateInput(), operator: { user_id: -1, session_token: "not-platform" } },
      pattern: /not the platform staff actor/u,
    },
    {
      name: "mismatched existing Wikidot identity",
      identity: candidateIdentity(),
      input: {
        ...privateInput(),
        account: {
          ...privateInput().account,
          public_name: "Different Account",
          login_identifier: "Different Account",
        },
      },
      pattern: /does not match the sealed Wikidot identity/u,
    },
  ];
  for (const scenario of scenarios) {
    await t.test(scenario.name, async (t) => {
      const paths = await fixtureFiles(t, scenario);
      const fixture = requestFixture();
      await assert.rejects(runCandidateAccountProvisioningCommand({
        "candidate-identity": paths.identityPath,
        "private-input": paths.privatePath,
        receipt: paths.receiptPath,
      }, { requestImpl: fixture.requestImpl }), scenario.pattern);
      await assert.rejects(fs.access(paths.receiptPath));
    });
  }
});

test("candidate account provisioning CLI accepts only file paths", () => {
  assert.deepEqual(parseCandidateAccountProvisioningArgs([
    "--candidate-identity", "candidate.json",
    "--private-input", "private.json",
    "--receipt", "receipt.json",
  ]), {
    "candidate-identity": "candidate.json",
    "private-input": "private.json",
    receipt: "receipt.json",
  });
  assert.throws(() => parseCandidateAccountProvisioningArgs([
    "--candidate-identity", "candidate.json",
    "--private-input", "private.json",
    "--password", "forbidden",
  ]), /unknown or duplicate option/u);
});
