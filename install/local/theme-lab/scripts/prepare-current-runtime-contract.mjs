#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deepwellRuntimeSourceIdentity,
  readRunningDeepwellRuntimeIdentity,
} from "../src/deepwell-runtime-identity.mjs";
import { framerailSourceFingerprintSync } from "../src/framerail-source-fingerprint.mjs";
import { prepareCurrentRuntimeContract } from "../src/current-runtime-contract-builder.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const flags = new Map();
for (const value of process.argv.slice(2)) {
  const match = value.match(/^--([a-z-]+)=(.+)$/u);
  if (!match || flags.has(match[1]))
    throw new Error(`invalid or duplicate option: ${value}`);
  flags.set(match[1], match[2]);
}
const required = ["run-id", "port", "runtime-repo", "required-head"];
const allowed = new Set([...required, "check-only", "backend-project"]);
if (
  [...flags.keys()].some((flag) => !allowed.has(flag)) ||
  required.some((flag) => !flags.has(flag))
)
  throw new Error(
    "usage: prepare-current-runtime-contract.mjs --runtime-repo=/absolute/checkout --required-head=40-hex-git-commit --run-id=task-identity --port=task-owned-port [--check-only=true]",
  );
if (
  flags.has("check-only") &&
  !["true", "false"].includes(flags.get("check-only"))
)
  throw new Error("check-only must be true or false");
const runtimeRepo = path.resolve(flags.get("runtime-repo"));
if (
  runtimeRepo !== flags.get("runtime-repo") ||
  !fs.statSync(runtimeRepo).isDirectory()
)
  throw new Error("runtime checkout must be an absolute directory");
const requestedHead = flags.get("required-head");
if (!/^[a-f0-9]{40}$/u.test(requestedHead))
  throw new Error("required-head must be an exact 40-digit Git commit");
const git = (...args) =>
  execFileSync("git", ["-C", runtimeRepo, ...args], {
    encoding: "utf8",
  }).trim();
if (git("rev-parse", "HEAD") !== requestedHead)
  throw new Error(
    "running checkout HEAD differs from the explicitly required revision; cannot claim current source",
  );
const status = git(
  "status",
  "--porcelain=v1",
  "--untracked-files=no",
  "--",
  "framerail",
  "deepwell",
  ".cargo",
  "locales",
  "install/local/deepwell",
  "install/common/deepwell",
);
if (status)
  throw new Error(
    "running checkout contains modified source inputs; cannot seal a current contract",
  );

// Check the checkout-independent identities before preparing any artifact.
const localDeepwell = deepwellRuntimeSourceIdentity(runtimeRepo);
const backendProject =
  flags.get("backend-project") ?? "wikijump-local-development";
if (
  backendProject !== "wikijump-local-development" &&
  !/^wikijump-theme-lab-[a-z][a-z0-9-]{2,30}$/u.test(backendProject)
)
  throw new Error("backend Compose project must be task-owned");
const running = readRunningDeepwellRuntimeIdentity(runtimeRepo, {
  composeProject: backendProject,
  containerName: `${backendProject}-deepwell-1`,
});
if (
  localDeepwell.source_sha256 !== running.identity.source_sha256 ||
  localDeepwell.ftml_git_revision !== running.identity.ftml_git_revision
)
  throw new Error(
    "current Deepwell source inputs changed during the runtime identity probe",
  );
const framerail = framerailSourceFingerprintSync(runtimeRepo);
const templateFile = path.join(
  root,
  "install/local/theme-lab/ports/current-acceptance/run-contract.json",
);
const template = JSON.parse(fs.readFileSync(templateFile, "utf8"));
const runId = flags.get("run-id");
const contract = prepareCurrentRuntimeContract(template, {
  runId,
  port: Number(flags.get("port")),
  framerailSourceSha: framerail,
  backendRuntimeIdentity: running.identity,
});
const output = path.join(
  path.dirname(templateFile),
  `run-contract-${runId}.json`,
);
if (fs.existsSync(output))
  throw new Error(
    "current capture run ID already exists; preserve previous contract",
  );
if (flags.get("check-only") !== "true") {
  fs.writeFileSync(output, JSON.stringify(contract, null, 2) + "\n", {
    flag: "wx",
    mode: 0o444,
  });
}
console.log(
  JSON.stringify(
    {
      status:
        flags.get("check-only") === "true"
          ? "source-bound-readiness-pass"
          : "new-capture-contract-written",
      run_id: runId,
      required_git_head: requestedHead,
      contract_path: output,
      expected_runtime_source_sha256: framerail,
      expected_backend_identity_sha256: running.identity.identity_sha256,
      transport_origin: contract.target_site.origin,
    },
    null,
    2,
  ),
);
