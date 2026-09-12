#!/usr/bin/env node

import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import process from "node:process";
import pw from "../../../../framerail/node_modules/@playwright/test/index.js";

const {chromium} = pw;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable: ${name}`);
  return value;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) throw new Error(`missing ${name}`);
  return process.argv[index + 1];
}

const site = argument("--site");
const output = argument("--output");
const runId = argument("--run-id");
if (!/^[a-z0-9-]+$/u.test(site) || !/^[A-Za-z0-9._-]+$/u.test(runId)) {
  throw new Error("invalid site or run id");
}

const markerAccept = `A1033-APP-ACCEPT-${runId}`;
const markerDecline = `A1033-APP-DECLINE-${runId}`;
const browser = await chromium.launch({headless: true, executablePath: "/usr/bin/google-chrome"});

async function login(username, password) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://${site}.wikidot.com/`, {waitUntil: "domcontentloaded"});
  await page.waitForFunction(() => typeof WIKIDOT?.page?.listeners?.loginClick === "function");
  const popupPromise = context.waitForEvent("page");
  await page.locator(".login-status-sign-in").click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await popup.locator('input[name="login"]').fill(username);
  await popup.locator('input[type="password"]').fill(password);
  await popup.getByRole("button", {name: /sign in/iu}).click();
  await popup.waitForEvent("close", {timeout: 20_000}).catch(() => undefined);
  await page.reload({waitUntil: "domcontentloaded"});
  if (await page.locator(".login-status-sign-in").count()) throw new Error("login failed");
  return {context, page};
}

function ajax(page, data, moduleName = null) {
  return page.evaluate(
    ({data, moduleName}) => new Promise((resolve) => OZONE.ajax.requestModule(moduleName, data, resolve)),
    {data, moduleName},
  );
}

function textOnly(body) {
  return String(body ?? "").replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();
}

function applicationUserId(body, marker, type) {
  const index = body.indexOf(marker);
  if (index < 0) throw new Error(`application marker not found: ${type}`);
  const chunk = body.slice(Math.max(0, index - 1600), index + marker.length + 2600);
  const pattern = new RegExp(`accept\\(event,\\s*(\\d+),[\\s\\S]*?'${type}'\\)`, "u");
  const match = chunk.match(pattern);
  if (!match) throw new Error(`application action user id not found: ${type}`);
  return Number(match[1]);
}

await mkdir(output, {recursive: true});
const record = {
  schema: "wikijump.open43.a1033_application_disposable_live.v2",
  site,
  run_id: runId,
  markers: {
    accept_sha256: sha256(markerAccept),
    decline_sha256: sha256(markerDecline),
  },
  started_at: new Date().toISOString(),
  credentials_persisted: false,
  mutations: [],
  cleanup: {},
};

const admin = await login(requireEnv("WIKIDOT_A_USERNAME"), requireEnv("WIKIDOT_A_PASSWORD"));
const acceptedActor = await login(requireEnv("WIKIDOT_D_USERNAME"), requireEnv("WIKIDOT_D_PASSWORD"));
const declinedActor = await login(requireEnv("WIKIDOT_E_USERNAME"), requireEnv("WIKIDOT_E_PASSWORD"));

try {
  const policy = await ajax(admin.page, {
    privacy: "closed",
    by_apply: "on",
    by_domain: "",
    password: "",
    allowHotlink: "on",
    landingPage: "system:join",
    hideNav: "on",
    viewers: "",
    action: "ManageSiteAction",
    event: "savePrivateSettings",
  });
  if (policy.status !== "ok") throw new Error(`policy setup failed: ${policy.status}`);
  record.mutations.push({kind: "policy_application", status: policy.status});

  const submit = async (page, marker) => ajax(
    page,
    {action: "MembershipApplyAction", event: "apply", comment: marker},
    "membership/MembershipApplySuccessModule",
  );

  const acceptFirst = await submit(acceptedActor.page, markerAccept);
  const acceptDuplicate = await submit(acceptedActor.page, markerAccept);
  record.accept_path = {
    first: {status: acceptFirst.status, body: textOnly(acceptFirst.body)},
    duplicate: {status: acceptDuplicate.status, body: textOnly(acceptDuplicate.body)},
  };
  record.mutations.push({kind: "application_submit_accept_actor", count: 2});

  let applications = await ajax(admin.page, {}, "managesite/ManageSiteMembersApplicationsModule");
  const acceptUserId = applicationUserId(String(applications.body ?? ""), markerAccept, "accept");
  record.accept_path.pending_marker_count = String(applications.body ?? "").split(markerAccept).length - 1;
  const accept = await ajax(admin.page, {
    action: "ManageSiteMembershipAction",
    event: "acceptApplication",
    user_id: acceptUserId,
    text: "run-owned acceptance",
    type: "accept",
  });
  record.accept_path.review = {status: accept.status, message: accept.message ?? null};
  record.mutations.push({kind: "application_accept"});

  const afterAccept = await ajax(admin.page, {}, "managesite/ManageSiteMembersApplicationsModule");
  record.accept_path.pending_after_accept = String(afterAccept.body ?? "").includes(markerAccept);
  const remove = await ajax(admin.page, {
    action: "ManageSiteMembershipAction",
    event: "removeMember",
    user_id: acceptUserId,
  });
  record.accept_path.remove_member = {status: remove.status, message: remove.message ?? null};
  record.mutations.push({kind: "accepted_member_remove"});
  const acceptReapply = await submit(acceptedActor.page, `${markerAccept}-REAPPLY`);
  record.accept_path.reapply_after_member_removal = {
    status: acceptReapply.status,
    body: textOnly(acceptReapply.body),
  };

  const declineFirst = await submit(declinedActor.page, markerDecline);
  record.decline_path = {first: {status: declineFirst.status, body: textOnly(declineFirst.body)}};
  record.mutations.push({kind: "application_submit_decline_actor"});
  applications = await ajax(admin.page, {}, "managesite/ManageSiteMembersApplicationsModule");
  const declineUserId = applicationUserId(String(applications.body ?? ""), markerDecline, "decline");
  record.decline_path.pending_marker_count = String(applications.body ?? "").split(markerDecline).length - 1;
  const decline = await ajax(admin.page, {
    action: "ManageSiteMembershipAction",
    event: "acceptApplication",
    user_id: declineUserId,
    text: "run-owned rejection",
    type: "decline",
  });
  record.decline_path.review = {status: decline.status, message: decline.message ?? null};
  record.mutations.push({kind: "application_decline"});
  const declineReapply = await submit(declinedActor.page, `${markerDecline}-REAPPLY`);
  record.decline_path.reapply_after_decline = {
    status: declineReapply.status,
    body: textOnly(declineReapply.body),
  };

  const finalApplications = await ajax(admin.page, {}, "managesite/ManageSiteMembersApplicationsModule");
  const finalBody = String(finalApplications.body ?? "");
  record.cleanup.pending_accept_marker_absent = !finalBody.includes(markerAccept);
  record.cleanup.pending_decline_marker_absent = !finalBody.includes(markerDecline);
} finally {
  const restore = await ajax(admin.page, {
    privacy: "open",
    by_domain: "",
    password: "",
    allowHotlink: "on",
    landingPage: "system:join",
    hideNav: "on",
    viewers: "",
    action: "ManageSiteAction",
    event: "savePrivateSettings",
  }).catch((error) => ({status: "error", message: String(error)}));
  record.cleanup.restore_policy = {status: restore.status, message: restore.message ?? null};
  record.finished_at = new Date().toISOString();
  await writeFile(`${output}/artifact.json`, `${JSON.stringify(record, null, 2)}\n`, {mode: 0o600});
  await acceptedActor.context.close();
  await declinedActor.context.close();
  await admin.context.close();
  await browser.close();
}

console.log(JSON.stringify({
  accept: record.accept_path,
  decline: record.decline_path,
  cleanup: record.cleanup,
}));
