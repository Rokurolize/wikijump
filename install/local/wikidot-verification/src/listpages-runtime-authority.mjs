import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const BUILD_MANIFEST_VERIFIER =
  "/home/roku/wjlab/scripts/candidate-artifact-manifest.py";
const REQUIRED_CONTAINERS = ["cache", "database", "files"];
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const FIXTURE_SNAPSHOT_SQL = `
WITH
  site_pages AS (
    SELECT page_id FROM page WHERE site_id = $SITE_ID
  ),
  relevant_users AS (
    SELECT user_id FROM page_revision WHERE site_id = $SITE_ID
    UNION SELECT user_id FROM page_vote WHERE page_id IN (SELECT page_id FROM site_pages)
    UNION SELECT user_id FROM file_revision WHERE site_id = $SITE_ID
    UNION SELECT user_id FROM forum_post WHERE site_id = $SITE_ID
  ),
  snapshot AS (
    SELECT 'site:' || to_jsonb(value)::text AS record FROM site value WHERE site_id = $SITE_ID
    UNION ALL SELECT 'site_domain:' || to_jsonb(value)::text FROM site_domain value WHERE site_id = $SITE_ID
    UNION ALL SELECT 'page_category:' || to_jsonb(value)::text FROM page_category value WHERE site_id = $SITE_ID
    UNION ALL SELECT 'page:' || to_jsonb(value)::text FROM page value WHERE site_id = $SITE_ID
    UNION ALL SELECT 'page_revision:' || to_jsonb(value)::text FROM page_revision value WHERE site_id = $SITE_ID
    UNION ALL SELECT 'page_parent:' || to_jsonb(value)::text FROM page_parent value
      WHERE parent_page_id IN (SELECT page_id FROM site_pages)
         OR child_page_id IN (SELECT page_id FROM site_pages)
    UNION ALL SELECT 'page_vote:' || to_jsonb(value)::text FROM page_vote value
      WHERE page_id IN (SELECT page_id FROM site_pages)
    UNION ALL SELECT 'file:' || to_jsonb(value)::text FROM file value WHERE site_id = $SITE_ID
    UNION ALL SELECT 'file_revision:' || to_jsonb(value)::text FROM file_revision value WHERE site_id = $SITE_ID
    UNION ALL SELECT 'forum_thread:' || to_jsonb(value)::text FROM forum_thread value WHERE site_id = $SITE_ID
    UNION ALL SELECT 'forum_post:' || to_jsonb(value)::text FROM forum_post value WHERE site_id = $SITE_ID
    UNION ALL SELECT 'known_user:' || to_jsonb(value)::text FROM known_user value
      WHERE user_id IN (SELECT user_id FROM relevant_users)
    UNION ALL SELECT 'user:' || to_jsonb(value)::text FROM "user" value
      WHERE user_id IN (SELECT user_id FROM relevant_users)
  )
SELECT record FROM snapshot ORDER BY record;
`;

export const LISTPAGES_RUNTIME_OBSERVATION_SCHEMA =
  "wikijump_listpages_compat.runtime_observation.v1";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256ListPagesFile(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

async function command(executable, args) {
  const { stdout } = await execFileAsync(executable, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

export function exactListPagesFtmlSha(lockContents) {
  const section = lockContents.match(
    /\[\[package\]\]\nname = "ftml"\n[\s\S]*?(?=\n\[\[package\]\]|$)/u,
  )?.[0];
  const source = section?.match(/^source = "([^"]+)"$/mu)?.[1];
  const revision = source?.match(/#([0-9a-f]{40})$/u)?.[1];
  if (!revision) {
    throw new Error(
      "running candidate Cargo.lock has no exact Rokurolize/ftml revision",
    );
  }
  return revision;
}

export function listPagesProcessStartTicks(statText, pid) {
  const close = statText.lastIndexOf(")");
  const fields = close < 0
    ? []
    : statText.slice(close + 1).trim().split(/\s+/u);
  const observedPid = Number(statText.slice(0, statText.indexOf(" ")));
  const startTicks = fields[19];
  if (
    observedPid !== pid ||
    typeof startTicks !== "string" ||
    !/^[1-9][0-9]*$/u.test(startTicks)
  ) {
    throw new Error("running candidate process stat is invalid");
  }
  return startTicks;
}

function requireExactProofLocators(proof) {
  const process = proof?.process;
  if (
    !Number.isSafeInteger(process?.pid) ||
    process.pid < 1 ||
    typeof process.start_ticks !== "string" ||
    !/^[1-9][0-9]*$/u.test(process.start_ticks) ||
    typeof process.config_path !== "string" ||
    !path.isAbsolute(process.config_path) ||
    typeof process.build_manifest_path !== "string" ||
    !path.isAbsolute(process.build_manifest_path)
  ) {
    throw new Error("runtime proof process locator is invalid");
  }
  const containers = proof.service_containers;
  if (
    containers === null ||
    typeof containers !== "object" ||
    Array.isArray(containers) ||
    JSON.stringify(Object.keys(containers).sort()) !==
      JSON.stringify(REQUIRED_CONTAINERS)
  ) {
    throw new Error(
      `runtime proof containers must be exactly ${REQUIRED_CONTAINERS.join(", ")}`,
    );
  }
  for (const service of REQUIRED_CONTAINERS) {
    if (!/^[0-9a-f]{64}$/u.test(containers[service] ?? "")) {
      throw new Error(`runtime proof ${service} container ID is invalid`);
    }
  }
  return { process, containers };
}

function requireBoundBuildManifest(
  manifest,
  identity,
  manifestSha256,
  verification,
) {
  if (
    manifestSha256 !== identity.build_manifest_sha256 ||
    manifest?.schema !== "roku.candidate_build_manifest.v1" ||
    manifest.source?.wikijump_sha !== identity.wikijump_sha ||
    manifest.source?.ftml_sha !== identity.ftml_sha ||
    manifest.build?.cargo_lock_sha256 !== identity.dependency_lock_sha256 ||
    manifest.build?.binary_sha256 !== identity.executable_sha256 ||
    manifest.build?.profile !== identity.profile ||
    manifest.artifact_key?.key !== identity.build_artifact_key ||
    manifest.build_attestation?.mode !== "wrapped_pre_post" ||
    verification?.status !== "bound" ||
    verification?.verified !== true ||
    verification?.manifest_sha256 !== manifestSha256
  ) {
    throw new Error(
      "running candidate build manifest does not bind the authoritative identity",
    );
  }
}

function requireListener(listenerText, rpcUrl, pid) {
  const url = new URL(rpcUrl);
  const port = url.port || "80";
  const expectedAddress = url.hostname === "[::1]"
    ? `[::1]:${port}`
    : `127.0.0.1:${port}`;
  const lines = listenerText.split(/\r?\n/u).filter(Boolean);
  const matches = lines.filter(
    (line) =>
      line.includes(expectedAddress) &&
      new RegExp(`pid=${pid}(?:,|\\))`, "u").test(line),
  );
  if (matches.length !== 1 || lines.length !== 1) {
    throw new Error("runtime proof PID does not exclusively own the RPC listener");
  }
}

function requireContainerInspection(
  inspectionText,
  service,
  containerId,
  expectedImage,
) {
  const parsed = JSON.parse(inspectionText);
  const inspection = Array.isArray(parsed) ? parsed[0] : parsed;
  const health = inspection?.State?.Health?.Status;
  if (
    inspection?.Id !== containerId ||
    inspection?.Image !== `sha256:${expectedImage}` ||
    inspection?.State?.Running !== true ||
    (health !== undefined && health !== "healthy")
  ) {
    throw new Error(
      `running ${service} container does not bind the authoritative identity`,
    );
  }
  return {
    container_id: containerId,
    image_sha256: expectedImage,
    started_at: inspection.State.StartedAt,
    health: health ?? null,
  };
}

function requireCommandLine(commandLine, process, rpcUrl) {
  const args = commandLine.toString("utf8").split("\0").filter(Boolean);
  const port = new URL(rpcUrl).port || "80";
  const portIndex = args.indexOf("--port");
  if (
    args.filter((value) => value === process.config_path).length !== 1 ||
    portIndex < 0 ||
    args[portIndex + 1] !== port
  ) {
    throw new Error(
      "running candidate command line does not bind the runtime config and RPC port",
    );
  }
  return sha256(commandLine);
}

export async function observeListPagesFixtureState({
  databaseContainerId,
  siteId,
  run = command,
}) {
  const sql = FIXTURE_SNAPSHOT_SQL.replaceAll("$SITE_ID", String(siteId));
  const script = [
    'exec env PGPASSWORD="$POSTGRES_PASSWORD"',
    "psql -h 127.0.0.1",
    '-U "${POSTGRES_USER:-wikijump}"',
    '-d "${POSTGRES_DB:-wikijump}"',
    "--no-align --tuples-only --set ON_ERROR_STOP=1",
    '--command "$1"',
  ].join(" ");
  const rows = await run("docker", [
    "exec",
    databaseContainerId,
    "sh",
    "-ec",
    script,
    "listpages-fixture-snapshot",
    sql,
  ]);
  return sha256(rows);
}

export async function observeListPagesRuntimeAuthority({
  identity,
  proof,
  phase,
  system = {},
}) {
  const { process, containers } = requireExactProofLocators(proof);
  const readFile = system.readFile ?? fs.readFile;
  const readlink = system.readlink ?? fs.readlink;
  const hashFile = system.hashFile ?? sha256ListPagesFile;
  const run = system.command ?? command;
  const fixtureDigest = system.fixtureDigest ??
    (() => observeListPagesFixtureState({
      run,
      databaseContainerId: containers.database,
      siteId: identity.site_id,
    }));
  const procRoot = `/proc/${process.pid}`;
  const [
    statText,
    commandLine,
    executablePath,
    repository,
    executableSha256,
    configSha256,
    configContents,
    manifestContents,
  ] = await Promise.all([
    readFile(path.join(procRoot, "stat"), "utf8"),
    readFile(path.join(procRoot, "cmdline")),
    readlink(path.join(procRoot, "exe")),
    readlink(path.join(procRoot, "cwd")),
    hashFile(path.join(procRoot, "exe")),
    hashFile(process.config_path),
    readFile(process.config_path),
    readFile(process.build_manifest_path, "utf8"),
  ]);
  if (listPagesProcessStartTicks(statText, process.pid) !== process.start_ticks) {
    throw new Error("running candidate PID was reused or restarted");
  }
  if (
    executableSha256 !== identity.executable_sha256 ||
    configSha256 !== identity.runtime_config_sha256
  ) {
    throw new Error(
      "running candidate executable or configuration differs from authority",
    );
  }
  const commandLineSha256 = requireCommandLine(
    commandLine,
    process,
    identity.rpc_url,
  );
  const lockPath = path.join(repository, "deepwell", "Cargo.lock");
  const [status, head, tree, lockContents, listenerText] = await Promise.all([
    run("git", [
      "-C",
      repository,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
    run("git", ["-C", repository, "rev-parse", "HEAD"]),
    run("git", ["-C", repository, "rev-parse", "HEAD^{tree}"]),
    readFile(lockPath, "utf8"),
    run("ss", [
      "-H",
      "-ltnp",
      "sport",
      "=",
      `:${new URL(identity.rpc_url).port || "80"}`,
    ]),
  ]);
  if (
    status !== "" ||
    head !== identity.wikijump_sha ||
    tree !== identity.wikijump_tree ||
    sha256(lockContents) !== identity.dependency_lock_sha256 ||
    exactListPagesFtmlSha(lockContents) !== identity.ftml_sha
  ) {
    throw new Error(
      "running candidate checkout differs from the authoritative source",
    );
  }
  requireListener(listenerText, identity.rpc_url, process.pid);

  const manifestSha256 = sha256(manifestContents);
  const verificationText = await run("python3", [
    BUILD_MANIFEST_VERIFIER,
    "verify",
    "--manifest",
    process.build_manifest_path,
    "--gate-mode",
    "acceptance",
    "--wikijump-sha",
    identity.wikijump_sha,
    "--ftml-sha",
    identity.ftml_sha,
    "--profile",
    identity.profile,
    "--cargo-lock-sha256",
    identity.dependency_lock_sha256,
    "--binary-sha256",
    identity.executable_sha256,
  ]);
  requireBoundBuildManifest(
    JSON.parse(manifestContents),
    identity,
    manifestSha256,
    JSON.parse(verificationText),
  );

  const serviceEntries = await Promise.all(
    REQUIRED_CONTAINERS.map(async (service) => [
      service,
      requireContainerInspection(
        await run("docker", ["inspect", containers[service]]),
        service,
        containers[service],
        identity.service_image_sha256[service],
      ),
    ]),
  );
  const fixtureStateSha256 = await fixtureDigest();
  if (!SHA256_PATTERN.test(fixtureStateSha256 ?? "")) {
    throw new Error("running ListPages fixture-state digest is invalid");
  }
  const stable = {
    run_nonce: proof.run_nonce,
    candidate: {
      wikijump_sha: identity.wikijump_sha,
      wikijump_tree: identity.wikijump_tree,
      ftml_sha: identity.ftml_sha,
      dependency_lock_sha256: identity.dependency_lock_sha256,
      build_manifest_sha256: identity.build_manifest_sha256,
      build_artifact_key: identity.build_artifact_key,
      executable_sha256: identity.executable_sha256,
      runtime_config_sha256: identity.runtime_config_sha256,
      profile: identity.profile,
    },
    process: {
      pid: process.pid,
      start_ticks: process.start_ticks,
      executable_path: executablePath,
      executable_sha256: executableSha256,
      repository,
      command_line_sha256: commandLineSha256,
      config_path: process.config_path,
      config_sha256: configSha256,
      config_contents_sha256: sha256(configContents),
      build_manifest_path: process.build_manifest_path,
      build_manifest_sha256: manifestSha256,
    },
    rpc_url: identity.rpc_url,
    fixture_state_sha256: fixtureStateSha256,
    services: Object.fromEntries(serviceEntries),
  };
  return {
    schema: LISTPAGES_RUNTIME_OBSERVATION_SCHEMA,
    status: "bound",
    phase,
    observed_at: new Date().toISOString(),
    stable_sha256: sha256(JSON.stringify(stable)),
    stable,
  };
}

export function validateListPagesRuntimeObservation(observation, phase) {
  const stable = observation?.stable;
  if (
    observation?.schema !== LISTPAGES_RUNTIME_OBSERVATION_SCHEMA ||
    observation.status !== "bound" ||
    observation.phase !== phase ||
    typeof observation.observed_at !== "string" ||
    Number.isNaN(Date.parse(observation.observed_at)) ||
    !SHA256_PATTERN.test(observation.stable_sha256 ?? "") ||
    stable === null ||
    typeof stable !== "object" ||
    Array.isArray(stable) ||
    !SHA256_PATTERN.test(stable.run_nonce ?? "") ||
    !SHA256_PATTERN.test(stable.fixture_state_sha256 ?? "") ||
    stable.candidate === null ||
    typeof stable.candidate !== "object" ||
    stable.process === null ||
    typeof stable.process !== "object" ||
    stable.services === null ||
    typeof stable.services !== "object" ||
    sha256(JSON.stringify(stable)) !== observation.stable_sha256
  ) {
    throw new Error(`authoritative runtime ${phase} observation is invalid`);
  }
  return observation;
}
