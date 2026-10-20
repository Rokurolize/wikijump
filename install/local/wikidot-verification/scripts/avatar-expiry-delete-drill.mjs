#!/usr/bin/env node
/**
 * Avatar expiry and delete live drill (offline preparation for #2556).
 *
 * THIS DRILL HAS NOT BEEN RUN. Executing it mutates standing (creates a
 * probe account, uploads and removes an avatar, deletes the account) and
 * needs the user's approval first. The default `--dry-run` prints the
 * ordered plan without performing any mutation.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { runCliIfMain } from "../src/cli-entry.mjs";
import {
  AVATAR_CACHE_TTL_SECONDS,
  PROBE_AVATAR_PNG,
  buildAvatarDrillPlan,
  summarizeDrillPlan,
} from "../src/avatar-expiry-delete-drill.mjs";
import { stableStringify } from "../src/canonical-json.mjs";

export function usage() {
  return [
    "Usage: avatar-expiry-delete-drill.mjs --dry-run --probe-username avatar-drill-<name> [...]",
    "       avatar-expiry-delete-drill.mjs --execute --confirm <probe-username> [...]",
    "",
    "Options (both modes):",
    "  --probe-username <name>  disposable probe account (must start with avatar-drill-)",
    "  --gateway-base <url>     files gateway base (default https://scp-wiki.wjfiles.localhost)",
    "  --deepwell-url <url>     deepwell JSON-RPC endpoint",
    "  --db-container <name>    standing database container for SELECT assertions",
    "  --cache-container <name> standing cache container for GET/TTL assertions",
    "  --operator-ip <ip>       operator IP recorded in the audit trail",
    "  --wait-seconds <n>       expiry wait, must exceed the 60s avatar TTL (default 65)",
    "Secrets come from the environment (never from flags):",
    "  AVATAR_DRILL_SESSION_TOKEN (deepwell session), AVATAR_DRILL_PROBE_PASSWORD.",
  ].join("\n");
}

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    execute: false,
    confirm: null,
    probeUsername: null,
    gatewayBase: "https://scp-wiki.wjfiles.localhost",
    deepwellUrl: null,
    dbContainer: "wikijump-standing-database-1",
    cacheContainer: "wikijump-standing-cache-1",
    operatorIp: null,
    waitSeconds: AVATAR_CACHE_TTL_SECONDS + 5,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--execute") args.execute = true;
    else if (arg === "--confirm") args.confirm = next();
    else if (arg === "--probe-username") args.probeUsername = next();
    else if (arg === "--gateway-base") args.gatewayBase = next();
    else if (arg === "--deepwell-url") args.deepwellUrl = next();
    else if (arg === "--db-container") args.dbContainer = next();
    else if (arg === "--cache-container") args.cacheContainer = next();
    else if (arg === "--operator-ip") args.operatorIp = next();
    else if (arg === "--wait-seconds") args.waitSeconds = Number(next());
    else if (arg === "--help" || arg === "-h") return { help: true };
    else throw new Error(`unknown argument: ${arg}\n${usage()}`);
  }
  return args;
}

function resolveSecrets(value, env) {
  if (Array.isArray(value)) return value.map((item) => resolveSecrets(item, env));
  if (value !== null && typeof value === "object") {
    if (typeof value.$secret === "string") {
      const secret = env[value.$secret];
      if (!secret) throw new Error(`missing required secret ${value.$secret} in the environment`);
      return secret;
    }
    if (typeof value.$ref === "string") return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveSecrets(item, env)]));
  }
  if (value === "PROBE_AVATAR_PNG") return PROBE_AVATAR_PNG;
  return value;
}

/**
 * Executor (UNTESTED — it shells docker and fetches standing, so it only
 * runs in an approved live drill, never in CI). Kept next to the plan so
 * the approved run executes exactly the reviewed steps.
 */
export async function executeStep(step, context, env) {
  const { request } = step;
  if (request.kind === "wait") {
    await new Promise((resolve) => setTimeout(resolve, request.seconds * 1000));
    return { elapsed: true };
  }
  if (request.kind === "http") {
    const init = { method: request.method };
    if (request.body !== undefined) {
      init.body = resolveSecrets(request.body, env);
    }
    const response = await fetch(resolveSecrets(request.url, env), init);
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, contentType: response.headers.get("content-type") ?? "", length: body.length };
  }
  if (request.kind === "rpc") {
    const params = resolveSecrets(request.params, env);
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && typeof value === "object" && "$ref" in value) {
        params[key] = context.bindings[value.$ref];
      }
    }
    const response = await fetch(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(env.AVATAR_DRILL_SESSION_TOKEN ? { authorization: `Bearer ${env.AVATAR_DRILL_SESSION_TOKEN}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: step.id, method: request.method, params }),
    });
    const payload = await response.json();
    if (payload.error) throw new Error(`RPC ${request.method} failed: ${stableStringify(payload.error)}`);
    return { rpc: "ok", result: payload.result };
  }
  if (request.kind === "db") {
    const run = spawnSync("docker", ["exec", request.container, "psql", "-U", "wikijump", "-d", "wikijump", "-h", "127.0.0.1", "-Atc", request.sql], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(`db assertion failed: ${run.stderr}`);
    return { rows: run.stdout.trim() === "" ? [] : run.stdout.trim().split("\n") };
  }
  if (request.kind === "cache") {
    const cacheRun = (command) => {
      const run = spawnSync("docker", ["exec", "-i", request.container, "valkey-cli", ...command.map(String)], { encoding: "utf8" });
      if (run.status !== 0) throw new Error(`cache assertion failed: ${run.stderr}`);
      return run.stdout.trim();
    };
    const out = cacheRun(request.command);
    const outcome = { value: out === "" ? null : out };
    if (request.ttlOf === true) {
      outcome.ttl = Number(cacheRun(["TTL", request.command[request.command.length - 1]]));
    }
    return outcome;
  }
  throw new Error(`unknown request kind ${(request ?? {}).kind}`);
}

function checkExpect(step, outcome) {
  const { expect } = step;
  if (expect.rpc === "ok") return;
  if (expect.rpc === "ok-or-missing-user") return;
  if (expect.field !== undefined) {
    const value = outcome.result?.[expect.field];
    if (expect.type === "integer" && !Number.isInteger(value)) {
      throw new Error(`step ${step.id}: expected integer ${expect.field}, got ${stableStringify(value)}`);
    }
    if (expect.type === "string" && typeof value !== "string") {
      throw new Error(`step ${step.id}: expected string ${expect.field}, got ${stableStringify(value)}`);
    }
    return { value };
  }
  if (expect.status !== undefined && outcome.status !== expect.status) {
    throw new Error(`step ${step.id}: expected HTTP ${expect.status}, got ${outcome.status}`);
  }
  if (expect.contentType !== undefined && !String(outcome.contentType).startsWith(expect.contentType)) {
    throw new Error(`step ${step.id}: expected content-type ${expect.contentType}, got ${outcome.contentType}`);
  }
  if (expect.minLength !== undefined && !(outcome.length >= expect.minLength)) {
    throw new Error(`step ${step.id}: expected body length >= ${expect.minLength}, got ${outcome.length}`);
  }
  if (expect.rows !== undefined && outcome.rows.length !== expect.rows) {
    throw new Error(`step ${step.id}: expected ${expect.rows} rows, got ${outcome.rows.length}`);
  }
  if (expect.has_avatar !== undefined) {
    const got = outcome.rows[0] === "t";
    if (got !== expect.has_avatar) throw new Error(`step ${step.id}: expected has_avatar=${expect.has_avatar}`);
  }
  if (expect.value !== undefined && outcome.value !== expect.value) {
    throw new Error(`step ${step.id}: expected cache value ${expect.value}, got ${outcome.value}`);
  }
  if (expect.present !== undefined) {
    const present = outcome.value !== null;
    if (present !== expect.present) throw new Error(`step ${step.id}: expected present=${expect.present}`);
  }
  if (expect.ttlSeconds !== undefined) {
    if (!Number.isInteger(outcome.ttl) || outcome.ttl < expect.ttlSeconds.min || outcome.ttl > expect.ttlSeconds.max) {
      throw new Error(`step ${step.id}: expected TTL in [${expect.ttlSeconds.min}, ${expect.ttlSeconds.max}], got ${outcome.ttl}`);
    }
  }
  if (expect.gone !== undefined || expect.elapsed !== undefined) return;
  return {};
}

export function main(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const plan = buildAvatarDrillPlan({
    probeUsername: args.probeUsername,
    gatewayBase: args.gatewayBase,
    deepwellUrl: args.deepwellUrl,
    dbContainer: args.dbContainer,
    cacheContainer: args.cacheContainer,
    operatorIp: args.operatorIp,
    waitSeconds: args.waitSeconds,
  });
  if (args.dryRun || !args.execute) {
    console.log(summarizeDrillPlan(plan));
    return 0;
  }
  if (args.confirm !== plan.probeUsername) {
    throw new Error("--execute requires --confirm <probe-username> naming the same disposable probe account");
  }
  console.log(`EXECUTING the avatar drill for ${plan.probeUsername} (approved run only).`);
  return runPlan(plan, env);
}

export async function runPlan(plan, env) {
  const context = { bindings: {} };
  const recordBinding = (step, outcome) => {
    if (outcome.result !== undefined && outcome.result !== null && typeof outcome.result === "object") {
      for (const [field, value] of Object.entries(outcome.result)) {
        context.bindings[`${step.id}.${field}`] = value;
      }
    }
  };
  try {
    for (const step of plan.steps) {
      const outcome = await executeStep(step, context, env);
      recordBinding(step, outcome);
      checkExpect(step, outcome);
    }
  } finally {
    for (const step of plan.cleanup) {
      try {
        const outcome = await executeStep(step, context, env);
        recordBinding(step, outcome);
      } catch (error) {
        console.error(`cleanup ${step.id} failed (continuing): ${error.message}`);
      }
    }
  }
  return 0;
}

await runCliIfMain(import.meta.url, main);
