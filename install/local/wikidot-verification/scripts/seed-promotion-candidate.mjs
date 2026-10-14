#!/usr/bin/env node

// Seed a started promotion candidate with the standing runtime's persistent
// state, so candidate parity measures the candidate build against the data it
// will serve after promotion.
//
// Standing is only read: its database is streamed out with pg_dump and its
// object store volume is mounted read-only. The candidate's own application
// containers are stopped and started again (never recreated), so the
// container identities sealed at candidate start remain valid. The candidate
// database is replaced by the dump, every object-store bucket the candidate
// itself created is filled from the same-named standing bucket without
// overwriting, and the candidate cache is flushed so no state derived from the
// empty database survives. On start, the candidate Deepwell migrates the
// restored schema forward. Saved pages keep the standing renderer generation;
// pre-render them with `install/standing/render_ahead.py` against the
// candidate containers when the generation differs.

import {execFile as execFileCallback, spawn} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";

import {validateCandidateParityIdentity} from "../src/standing-browser-parity-receipt.mjs";
import {sealJsonNoReplace} from "../src/standing-browser-parity-util.mjs";
import {runCliIfMain} from "../src/cli-entry.mjs";

const execFile = promisify(execFileCallback);
const DOCKER = "/usr/bin/docker";
const STANDING_PROJECT = "wikijump-standing";
const APPLICATION_ROLES = Object.freeze(["wws", "framerail", "deepwell"]);
const COPY_IMAGE = "debian:bookworm-slim";

function fail(message) {
  throw new Error(message);
}

/** The containers and buckets one seeding run touches. Refuses anything that
 * is not an isolated candidate. */
export function seedPlan({identity, standingBuckets, candidateBuckets}) {
  const candidate = identity.candidate;
  const project = candidate.compose_project;
  if (project === STANDING_PROJECT || !/^wjcand-[a-z0-9-]+$/u.test(project)) {
    fail(`refusing to seed ${project}: not an isolated candidate project`);
  }
  if (candidate.port_443_published !== false || candidate.owner !== "compatibility-candidate") {
    fail("refusing to seed a candidate that publishes port 443 or is not candidate-owned");
  }
  const visible = (names) => new Set(names.filter((name) => name && !name.startsWith(".")));
  const standing = visible(standingBuckets);
  const buckets = [...visible(candidateBuckets)].filter((name) => standing.has(name)).sort();
  if (buckets.length === 0) fail("the candidate object store shares no bucket with standing");
  const container = (prefix, role) => `${prefix}-${role}-1`;
  return Object.freeze({
    project,
    buckets,
    standing: {database: container(STANDING_PROJECT, "database"), files: container(STANDING_PROJECT, "files")},
    candidate: Object.freeze(Object.fromEntries(
      ["database", "files", "cache", ...APPLICATION_ROLES].map((role) => [role, container(project, role)]),
    )),
  });
}

async function docker(...args) {
  const {stdout} = await execFile(DOCKER, args, {encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
  return stdout.trim();
}

async function volumeAt(container, destination) {
  const [inspect] = JSON.parse(await docker("inspect", container));
  const mount = inspect.Mounts?.find((entry) => entry.Destination === destination && entry.Type === "volume");
  if (!mount?.Name) fail(`${container} has no volume at ${destination}`);
  return mount.Name;
}

async function listDirectories(volume) {
  const output = await docker("run", "--rm", "--network", "none", "-v", `${volume}:/v:ro`, COPY_IMAGE,
    "find", "/v", "-mindepth", "1", "-maxdepth", "1", "-type", "d", "-printf", "%f\\n");
  return output.split("\n").filter(Boolean);
}

async function sql(container, database, statement) {
  return docker("exec", container, "psql", "-U", "wikijump", "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c", statement);
}

/** Stream `pg_dump` from standing into `pg_restore` on the candidate,
 * hashing the custom-format dump on the way through. */
function streamDatabase(plan) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    const dump = spawn(DOCKER, ["exec", plan.standing.database, "pg_dump", "-U", "wikijump", "-d", "wikijump", "--format=custom", "--no-owner"], {stdio: ["ignore", "pipe", "pipe"]});
    const restore = spawn(DOCKER, ["exec", "-i", plan.candidate.database, "pg_restore", "-U", "wikijump", "-d", "wikijump", "--no-owner", "--exit-on-error"], {stdio: ["pipe", "ignore", "pipe"]});
    const errors = {dump: "", restore: ""};
    dump.stderr.on("data", (chunk) => { errors.dump += chunk; });
    restore.stderr.on("data", (chunk) => { errors.restore += chunk; });
    dump.stdout.on("data", (chunk) => { hash.update(chunk); bytes += chunk.length; });
    dump.stdout.pipe(restore.stdin);
    const exits = [dump, restore].map((child) => new Promise((done) => child.on("close", (code) => done(code))));
    Promise.all(exits).then(([dumpCode, restoreCode]) => {
      if (dumpCode !== 0) reject(new Error(`standing pg_dump failed (${dumpCode}): ${errors.dump.trim().slice(-2000)}`));
      else if (restoreCode !== 0) reject(new Error(`candidate pg_restore failed (${restoreCode}): ${errors.restore.trim().slice(-2000)}`));
      else resolve({sha256: hash.digest("hex"), bytes});
    }, reject);
  });
}

async function waitHealthy(containers, timeoutMs = 20 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const states = await Promise.all(containers.map((name) => docker("inspect", "-f", "{{.State.Running}} {{.State.Health.Status}}", name)));
    if (states.every((state) => state === "true healthy")) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  fail(`candidate services did not become healthy: ${containers.join(", ")}`);
}

async function pageCount(container) {
  return Number(await sql(container, "wikijump", "SELECT count(*) FROM page WHERE deleted_at IS NULL"));
}

export async function seedPromotionCandidate({candidateRoot, output}) {
  const identity = validateCandidateParityIdentity(JSON.parse(await fs.readFile(path.join(candidateRoot, "candidate-identity.json"), "utf8")));
  const project = identity.candidate.compose_project;
  const standingFiles = await volumeAt(`${STANDING_PROJECT}-files-1`, "/data");
  const candidateFiles = await volumeAt(`${project}-files-1`, "/data");
  const plan = seedPlan({
    identity,
    standingBuckets: await listDirectories(standingFiles),
    candidateBuckets: await listDirectories(candidateFiles),
  });
  const containerIds = Object.fromEntries(await Promise.all(Object.entries(plan.candidate).map(async ([role, name]) => [role, await docker("inspect", "-f", "{{.Id}}", name)])));
  const startedAt = new Date();
  const timings = {};
  const timed = async (name, action) => {
    const begin = Date.now();
    const result = await action();
    timings[name] = (Date.now() - begin) / 1000;
    return result;
  };

  await timed("stop_applications", () => docker("stop", ...APPLICATION_ROLES.map((role) => plan.candidate[role])));
  const dump = await timed("database", async () => {
    await sql(plan.candidate.database, "postgres", "DROP DATABASE IF EXISTS wikijump WITH (FORCE)");
    await sql(plan.candidate.database, "postgres", "CREATE DATABASE wikijump OWNER wikijump");
    return streamDatabase(plan);
  });
  await timed("files", async () => {
    await docker("stop", plan.candidate.files);
    try {
      const copies = plan.buckets.map((bucket) => `cp -a -n /s/${bucket}/. /c/${bucket}/`).join(" && ");
      await docker("run", "--rm", "--network", "none", "-v", `${standingFiles}:/s:ro`, "-v", `${candidateFiles}:/c`, COPY_IMAGE, "sh", "-c", copies);
    } finally {
      await docker("start", plan.candidate.files);
    }
  });
  await timed("cache", () => docker("exec", plan.candidate.cache, "valkey-cli", "FLUSHALL"));
  await timed("start_applications", async () => {
    await waitHealthy([plan.candidate.files]);
    await docker("start", plan.candidate.deepwell);
    await waitHealthy([plan.candidate.deepwell]);
    await docker("start", plan.candidate.framerail, plan.candidate.wws);
    await waitHealthy(Object.values(plan.candidate));
  });

  for (const [role, name] of Object.entries(plan.candidate)) {
    if (await docker("inspect", "-f", "{{.Id}}", name) !== containerIds[role]) fail(`candidate ${role} container was recreated`);
  }
  const [standingPages, candidatePages] = await Promise.all([pageCount(plan.standing.database), pageCount(plan.candidate.database)]);
  if (standingPages !== candidatePages) fail(`candidate has ${candidatePages} pages, standing ${standingPages}`);
  const receipt = {
    schema: "wikijump.promotion_candidate_seed.v1",
    status: "pass",
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    candidate: {project, wikijump_commit: identity.candidate.wikijump_commit, container_ids: containerIds},
    standing: {
      wikijump_sha: await docker("inspect", "-f", '{{index .Config.Labels "com.rokurolize.wikijump.sha"}}', `${STANDING_PROJECT}-deepwell-1`),
      database_dump: dump,
      files_volume: standingFiles,
    },
    buckets: plan.buckets,
    pages: candidatePages,
    timings_seconds: timings,
  };
  const sealed = await sealJsonNoReplace(output, receipt);
  return {receipt, sealed};
}

export async function main(argv, {stdout = console.log} = {}) {
  if (argv.length !== 4 || argv[0] !== "--candidate-root" || argv[2] !== "--output") {
    fail("usage: seed-promotion-candidate.mjs --candidate-root DIR --output FILE");
  }
  const {receipt, sealed} = await seedPromotionCandidate({candidateRoot: path.resolve(argv[1]), output: path.resolve(argv[3])});
  stdout(JSON.stringify({status: receipt.status, pages: receipt.pages, output: sealed.path, sha256: sealed.sha256}));
  return 0;
}

await runCliIfMain(import.meta.url, main, {onError: (error) => { console.error(error?.stack ?? String(error)); return 1; }});
