import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OFFLINE_TARBALL_ERROR_RE = /ERR_PNPM_NO_OFFLINE_TARBALL/u;
const PNPM11_OFFLINE_TARBALL_RE =
  /A package is missing from the store but cannot download it in offline mode\.(?:\s*The missing package may be downloaded from\s+(\S+?)(?:\.(?=\s|$)|[\s'"]|$))?/iu;
const TARBALL_URL_RE = /(https?:\/\/\S+\.(?:tgz|tar\.gz))/iu;
const TARBALL_NAME_RE = /([@a-z0-9_.-]+(?:\/[a-z0-9_.-]+)?-[0-9][^\s/'"]*\.(?:tgz|tar\.gz))/iu;

/**
 * Resolve the persistent pnpm store directory outside `/tmp`.
 *
 * Uses `WIKIJUMP_PNPM_STORE_DIR` when explicitly provided (refusing `/tmp`),
 * otherwise `${XDG_STATE_HOME:-$HOME/.local/state}/wikijump/pnpm-store`.
 */
export function resolvePersistentPnpmStoreDir(
  env = process.env,
  homeDir = os.homedir(),
) {
  const override = env.WIKIJUMP_PNPM_STORE_DIR?.trim();
  if (override) {
    const resolved = path.resolve(override);
    if (resolved === "/tmp" || resolved.startsWith("/tmp/")) {
      throw new Error(
        `WIKIJUMP_PNPM_STORE_DIR must point to a persistent directory outside /tmp, got ${override}`,
      );
    }
    return resolved;
  }

  const stateHome = env.XDG_STATE_HOME?.trim();
  const baseDir = stateHome && path.isAbsolute(stateHome)
    ? stateHome
    : path.join(homeDir, ".local", "state");
  return path.join(baseDir, "wikijump", "pnpm-store");
}

/**
 * Detect an offline pnpm missing-tarball failure and extract the named tarball
 * or download URL when present in pnpm's output.
 */
export function extractMissingOfflineTarball(output = "") {
  const text = String(output);
  const v11Match = PNPM11_OFFLINE_TARBALL_RE.exec(text);
  const codeMatched = OFFLINE_TARBALL_ERROR_RE.test(text);
  if (!codeMatched && !v11Match) {
    return { matched: false, url: null, tarball: null };
  }

  const url = v11Match?.[1] ?? TARBALL_URL_RE.exec(text)?.[1] ?? null;
  let tarball = null;
  if (url) {
    const cleanUrl = url.split("?")[0];
    tarball = path.posix.basename(cleanUrl) || null;
  } else {
    tarball = TARBALL_NAME_RE.exec(text)?.[1] ?? null;
  }

  return { matched: true, url, tarball };
}

function defaultRunner(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function buildOnlineFetchEnv(env, storeDir) {
  const fetchEnv = { ...env, PNPM_CONFIG_STORE_DIR: storeDir };
  delete fetchEnv.PNPM_CONFIG_OFFLINE;
  delete fetchEnv.npm_config_offline;
  return fetchEnv;
}

function buildOfflineInstallEnv(env, storeDir) {
  return {
    ...env,
    PNPM_CONFIG_STORE_DIR: storeDir,
    PNPM_CONFIG_OFFLINE: "true",
    npm_config_offline: "true",
  };
}

function formatCommandFailure(label, result) {
  if (result.error) {
    return `${label}: ${result.error.message}`;
  }
  const detail = result.signal
    ? `signal ${result.signal}`
    : `exit ${result.status ?? "unknown"}`;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return output ? `${label} (${detail}):\n${output}` : `${label} (${detail})`;
}

/**
 * Install pnpm dependencies offline against the persistent store, healing once
 * when a missing offline tarball is reported outside hermetic test guards.
 */
export function ensurePnpmDependencies({
  dir,
  requirePath = null,
  storeDir = resolvePersistentPnpmStoreDir(),
  env = process.env,
  run = defaultRunner,
  log = (message) => process.stderr.write(`${message}\n`),
} = {}) {
  if (!dir) {
    throw new Error("ensurePnpmDependencies requires a target directory");
  }
  const packageDir = path.resolve(dir);
  if (requirePath && fs.existsSync(path.join(packageDir, requirePath))) {
    return { status: "present", healed: false, missingTarball: null, storeDir };
  }

  fs.mkdirSync(storeDir, { recursive: true });
  const installArgs = [
    "install",
    "--frozen-lockfile",
    "--offline",
    "--store-dir",
    storeDir,
  ];
  const offlineEnv = buildOfflineInstallEnv(env, storeDir);
  const firstAttempt = run("pnpm", installArgs, { cwd: packageDir, env: offlineEnv });
  if (!firstAttempt.error && firstAttempt.status === 0) {
    return { status: "installed", healed: false, missingTarball: null, storeDir };
  }

  const combinedOutput = `${firstAttempt.stdout ?? ""}\n${firstAttempt.stderr ?? ""}`;
  const missing = extractMissingOfflineTarball(combinedOutput);
  if (!missing.matched) {
    throw new Error(
      formatCommandFailure(`pnpm offline install failed in ${packageDir}`, firstAttempt),
    );
  }

  const namedTarget = missing.url ?? missing.tarball ?? "unnamed offline tarball";
  if (
    env.WIKIJUMP_TEST_NETWORK_GUARD_ACTIVE === "1" ||
    env.WIKIJUMP_BROWSER_TEST_NETNS_ACTIVE === "1"
  ) {
    throw new Error(
      `pnpm offline store ${storeDir} is missing tarball ${namedTarget} inside an offline test guard; ` +
        `install dependencies before entering the hermetic test step`,
    );
  }

  log(
    `pnpm offline store (${storeDir}) missing ${namedTarget}; fetching missing tarball(s) once and retrying offline install once`,
  );

  const fetchEnv = buildOnlineFetchEnv(env, storeDir);
  const fetchArgs = [
    "fetch",
    "--frozen-lockfile",
    "--ignore-scripts",
    "--store-dir",
    storeDir,
  ];
  const fetchResult = run("pnpm", fetchArgs, { cwd: packageDir, env: fetchEnv });
  if (fetchResult.error || fetchResult.status !== 0) {
    throw new Error(
      formatCommandFailure(
        `pnpm fetch failed while healing ${namedTarget} in ${packageDir}`,
        fetchResult,
      ),
    );
  }

  const retryAttempt = run("pnpm", installArgs, { cwd: packageDir, env: offlineEnv });
  if (!retryAttempt.error && retryAttempt.status === 0) {
    return {
      status: "healed",
      healed: true,
      missingTarball: namedTarget,
      storeDir,
    };
  }

  throw new Error(
    formatCommandFailure(
      `pnpm offline install retry failed in ${packageDir} after fetching ${namedTarget}`,
      retryAttempt,
    ),
  );
}
