#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

import {visibleText as parsedVisibleText} from "../src/syntax-differential.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const verifierRoot = path.resolve(path.dirname(scriptPath), "..");
const defaultCasesPath = path.join(verifierRoot, "fixtures/userinfo-target-routes/cases.json");
const defaultOutputPath = path.join(verifierRoot, "artifacts/userinfo-target-routes-live-20260810.json");
const maximumBoundedBodyCharacters = 30_000;
const publicOrigin = "https://www.wikidot.com";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function validateRouteTarget(value) {
  if (typeof value !== "string" || !/^(?:[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*|-\d+)$/u.test(value)) throw new Error("UserInfo route target is not a single allowlisted path segment");
  return value;
}

export function validateUserInfoUrl(value) {
  const parsed = new URL(value);
  const target = parsed.pathname.slice("/user:info/".length);
  let validTarget = false;
  try {
    validateRouteTarget(decodeURIComponent(target));
    validTarget = true;
  } catch {}
  if (parsed.origin !== publicOrigin || !/^\/user:info\/[^/]+$/u.test(parsed.pathname) || !validTarget) throw new Error(`UserInfo capture left the declared route: ${value}`);
  return parsed;
}

function parseArgs(argv) {
  const args = {cases: defaultCasesPath, output: defaultOutputPath, delayMs: 4000};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--cases" && value) args.cases = path.resolve(value);
    else if (key === "--output" && value) args.output = path.resolve(value);
    else if (key === "--delay-ms" && value && /^\d+$/u.test(value)) args.delayMs = Number(value);
    else throw new Error(`Unknown or incomplete argument: ${key}`);
    index += 1;
  }
  return args;
}

export function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/gu, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/giu, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&amp;/giu, "&");
}

function visibleText(value) {
  return parsedVisibleText(value)
    .replace(/\s+/gu, " ")
    .trim();
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gsu)) result[match[1].toLowerCase()] = decodeHtml(match[3]);
  return result;
}

function elements(value, tagName) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "giu");
  return [...value.matchAll(pattern)].map(([outer]) => ({outer, attributes: attributes(outer.slice(0, outer.indexOf(">") + 1)), text: visibleText(outer)}));
}

function extractBoundedBody(body) {
  const match = body.match(/<div\s+id=["']page-content["'][^>]*>([\s\S]*?)<div\s+id=["']action-area["']/iu);
  if (!match) throw new Error("Final HTML has no bounded #page-content to #action-area region");
  if (match[1].length > maximumBoundedBodyCharacters) throw new Error(`Bounded body exceeds ${maximumBoundedBodyCharacters} characters`);
  return match[1];
}

function profileProjection(boundedBody, target) {
  const classTokens = [...boundedBody.matchAll(/\bclass\s*=\s*(["'])(.*?)\1/gsu)]
    .flatMap((match) => match[2].split(/\s+/u))
    .filter(Boolean);
  const safeLinks = elements(boundedBody, "a")
    .filter(({attributes: attrs}) => attrs.href && !attrs.href.includes("/account/messages"))
    .map(({attributes: attrs, text}) => ({
      href: attrs.href,
      text,
      ...(attrs.id ? {id: attrs.id} : {}),
      ...(attrs.class ? {class_tokens: attrs.class.split(/\s+/u).filter(Boolean).sort()} : {})
    }));
  const errorMatch = boundedBody.match(/<div\b[^>]*class=["'][^"']*\berror-block\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/iu);
  const profileTitle = boundedBody.match(/<h1\b[^>]*class=["'][^"']*\bprofile-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/iu);
  const userIdMatch = boundedBody.match(/USERINFO\.userId\s*=\s*(\d+)\s*;/u);
  const avatarTag = profileTitle?.[1].match(/<img\b[^>]*>/iu)?.[0] ?? null;
  const avatarAttrs = avatarTag ? attributes(avatarTag) : null;
  const publicFields = [...boundedBody.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/giu)]
    .map((match) => ({label: visibleText(match[1]), value: visibleText(match[2])}))
    .filter(({label}) => !/email|message/iu.test(label));
  const publicName = profileTitle ? visibleText(profileTitle[1].replace(/<img\b[^>]*>/iu, "")) : null;
  const publicUserId = userIdMatch ? Number(userIdMatch[1]) : null;
  const error = errorMatch ? visibleText(errorMatch[1]) : null;

  if (target.expected_result === "populated-profile") {
    if (publicName !== target.public_name || publicUserId !== target.public_user_id || error !== null || !avatarAttrs?.src) {
      throw new Error(`Populated profile contract mismatch for ${target.target_id}`);
    }
  } else if (error !== "User does not exist." || publicName !== null || publicUserId !== null) {
    throw new Error(`Missing-user contract mismatch for ${target.target_id}`);
  }

  return {
    class_tokens: [...new Set(classTokens)].sort(),
    safe_links: safeLinks,
    private_message_control_present: /data-redacted-control=["']private-message["']/iu.test(boundedBody),
    profile: publicName === null ? null : {public_name: publicName, public_user_id: publicUserId},
    avatar: avatarAttrs ? {src: avatarAttrs.src, alt: avatarAttrs.alt ?? "", class_tokens: (avatarAttrs.class ?? "").split(/\s+/u).filter(Boolean).sort()} : null,
    public_fields: publicFields,
    error
  };
}

function normalizeBoundedBody(value) {
  return value.replace(/([?&](?:amp;)?timestamp=)\d+/giu, "$1[TIMESTAMP]");
}

function redactPrivateContent(value, accountUsername) {
  let privateMessageControls = 0;
  const withoutPrivateMessageLinks = value.replace(/<a\b[^>]*href=["'][^"']*\/account\/messages[^"']*["'][^>]*>[\s\S]*?<\/a>/giu, () => {
    privateMessageControls += 1;
    return '<span data-redacted-control="private-message">Write private message</span>';
  });
  return {
    body: accountUsername ? withoutPrivateMessageLinks.split(accountUsername).join("[REDACTED_ACCOUNT_A]") : withoutPrivateMessageLinks,
    privateMessageControls
  };
}

function createThrottle(delayMs) {
  let nextAt = 0;
  return async () => {
    const waitMs = Math.max(0, nextAt - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    nextAt = Date.now() + delayMs;
  };
}

async function loginAccountA(throttle) {
  const username = process.env.WIKIDOT_USERNAME;
  const password = process.env.WIKIDOT_PASSWORD;
  if (!username || !password) throw new Error("Account A comparison requires WIKIDOT_USERNAME and WIKIDOT_PASSWORD in the environment");
  await throttle();
  const response = await fetch("https://www.wikidot.com/default--flow/login__LoginPopupScreen", {
    method: "POST",
    redirect: "manual",
    headers: {"content-type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({login: username, password, action: "Login2Action", event: "login"})
  });
  if (response.status !== 200) throw new Error(`Account A login returned HTTP ${response.status}`);
  const setCookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const session = setCookies.map((value) => value.match(/(?:^|;\s*)WIKIDOT_SESSION_ID=([^;]+)/u)?.[1]).find(Boolean);
  if (!session) throw new Error("Account A login did not return the expected session cookie");
  return {username, cookieHeader: `WIKIDOT_SESSION_ID=${session}`};
}

async function captureRoute(url, cookieHeader, throttle) {
  const redirects = [];
  let current = url;
  for (let count = 0; count < 6; count += 1) {
    const parsed = validateUserInfoUrl(current);
    const headers = cookieHeader ? {cookie: cookieHeader} : {};
    await throttle();
    const response = await fetch(current, {method: "GET", redirect: "manual", headers});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect from ${current} omitted Location`);
      const next = validateUserInfoUrl(new URL(location, current).href).href;
      redirects.push({status: response.status, url: current, location: next});
      current = next;
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return {redirects, response, body: bytes.toString("utf8"), bytes, finalUrl: current};
  }
  throw new Error(`Redirect limit exceeded for ${url}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const casesBytes = await fs.readFile(args.cases);
  const fixture = JSON.parse(casesBytes);
  if (fixture.schema !== "wikijump.userinfo_target_routes.cases.v1" || fixture.cases.length !== 8) throw new Error("Unexpected UserInfo target-route fixture");
  for (const target of fixture.targets) validateRouteTarget(target.route_target);
  await fs.stat(args.output).then(() => { throw new Error(`Refusing to replace existing output: ${args.output}`); }, (error) => { if (error.code !== "ENOENT") throw error; });

  const actors = new Map(fixture.actors.map((actor) => [actor.actor_id, actor]));
  const targets = new Map(fixture.targets.map((target) => [target.target_id, target]));
  const throttle = createThrottle(args.delayMs);
  const account = await loginAccountA(throttle);
  const observations = [];

  for (const entry of fixture.cases) {
    const actor = actors.get(entry.actor_id);
    const target = targets.get(entry.target_id);
    if (!actor || !target) throw new Error(`Unresolved fixture reference in ${entry.case_id}`);
    const requestUrl = `${publicOrigin}/user:info/${target.route_target}`;
    const capture = await captureRoute(requestUrl, actor.authenticated ? account.cookieHeader : null, throttle);
    const rawBoundedBody = extractBoundedBody(capture.body);
    const redacted = redactPrivateContent(rawBoundedBody, account.username);
    const boundedBody = redacted.body;
    const normalizedBoundedBody = normalizeBoundedBody(boundedBody);
    const dom = profileProjection(boundedBody, target);
    observations.push({
      case_id: entry.case_id,
      actor_id: entry.actor_id,
      authenticated: actor.authenticated,
      target_id: entry.target_id,
      target_kind: target.kind,
      request: {method: "GET", url: requestUrl},
      redirect_chain: capture.redirects,
      response: {
        status: capture.response.status,
        content_type: capture.response.headers.get("content-type") ?? "",
        final_url: capture.finalUrl,
        body_bytes: capture.bytes.length,
        body_sha256: sha256(capture.bytes),
        bounded_body: boundedBody,
        bounded_body_redactions: {private_message_destination_links: redacted.privateMessageControls},
        bounded_body_sha256: sha256(boundedBody),
        normalized_bounded_body_sha256: sha256(normalizedBoundedBody)
      },
      result: target.expected_result,
      dom
    });
  }

  let differingNormalizedBodies = 0;
  for (const target of fixture.targets) {
    const pair = observations.filter((observation) => observation.target_id === target.target_id);
    if (pair.length !== 2) throw new Error(`Expected two actor observations for ${target.target_id}`);
    if (pair[0].response.normalized_bounded_body_sha256 !== pair[1].response.normalized_bounded_body_sha256) differingNormalizedBodies += 1;
  }
  const storedText = observations.map(({response}) => response.bounded_body).join("\n");
  const credentialHits = [process.env.WIKIDOT_PASSWORD, account.cookieHeader].filter(Boolean).filter((value) => storedText.includes(value)).length;
  const emailHits = storedText.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu)?.length ?? 0;
  if (credentialHits || emailHits) throw new Error("Privacy review rejected captured bounded content");

  const artifact = {
    schema: "wikijump.userinfo_target_routes.live_evidence.v1",
    captured_at: new Date().toISOString(),
    surface_ids: fixture.surface_ids,
    public_interface: fixture.public_interface,
    cases_path: path.relative(path.resolve(verifierRoot, "../../.."), args.cases),
    cases_sha256: sha256(casesBytes),
    capture_script_path: path.relative(path.resolve(verifierRoot, "../../.."), scriptPath),
    capture_script_sha256: sha256(await fs.readFile(scriptPath)),
    mutated: false,
    authentication_session_created: true,
    capture_policy: {
      maximum_bounded_body_characters: maximumBoundedBodyCharacters,
      external_request_minimum_interval_ms: args.delayMs,
      account_cookie_sent_only_to: "https://www.wikidot.com",
      response_headers_retained: ["content-type"],
      raw_full_body_retained: false,
      prior_no_target_preview_recaptured: false
    },
    prior_no_target_negative_control: fixture.prior_no_target_negative_control,
    controls: {positive_actor_cases: 4, negative_actor_cases: 4, prior_no_target_negative_cases: 2},
    observations,
    actor_differential: {
      compared_targets: fixture.targets.length,
      differing_normalized_bodies: differingNormalizedBodies,
      conclusion: differingNormalizedBodies === 0
        ? "No anonymous versus Account A differential was observed in the bounded UserInfo content."
        : "Anonymous versus Account A bounded UserInfo content differed for at least one target."
    },
    privacy_review: {
      credentials_or_cookie_hits: credentialHits,
      private_fields_captured: false,
      messages_captured: false,
      email_addresses_captured: emailHits > 0,
      account_a_identity: "redacted-sandbox-account-a",
      excluded: ["credentials", "cookies", "response authentication headers", "private message destination URLs", "email addresses", "message bodies", "session state"]
    },
    notes: [
      "This artifact observes target binding only through the public user:info path suffix. It does not claim or send a UserInfo module parameter.",
      "The no-target No user specified. preview is a prior negative control and is not a positive control or a recaptured case.",
      "Non-positive numeric route targets 0 and -1 returned the same public missing-user result for both actors."
    ]
  };
  await fs.mkdir(path.dirname(args.output), {recursive: true});
  await fs.writeFile(args.output, `${JSON.stringify(artifact, null, 2)}\n`, {encoding: "utf8", flag: "wx", mode: 0o644});
  process.stdout.write(`${JSON.stringify({output: args.output, cases: observations.length, actor_differences: differingNormalizedBodies, sha256: sha256(await fs.readFile(args.output))})}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await main();
