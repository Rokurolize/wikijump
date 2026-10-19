#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isolatedStackOverride,
  isolatedStackProject,
  verifyIsolatedCompose,
} from "../src/isolated-stack-plan.mjs";

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^--([a-z-]+)=(.+)$/u);
  if (!match || args.has(match[1]))
    throw new Error(`invalid or duplicate argument: ${arg}`);
  args.set(match[1], match[2]);
}
const expected = ["runtime-repo", "required-head", "namespace"];
if (
  [...args.keys()].some(
    (key) => ![...expected, "write", "output-dir"].includes(key),
  ) ||
  expected.some((key) => !args.has(key)) ||
  (args.has("write") && !["true", "false"].includes(args.get("write")))
)
  throw new Error(
    "usage: prepare-isolated-runtime-stack.mjs --runtime-repo=/absolute/checkout --required-head=40-hex-commit --namespace=task-name [--write=true --output-dir=/absolute/independent/directory]",
  );
if (args.get("write") === "true" && !args.has("output-dir"))
  throw new Error("--write=true requires an explicit external --output-dir");
const root = path.resolve(args.get("runtime-repo"));
if (
  root !== args.get("runtime-repo") ||
  !fs.statSync(root).isDirectory() ||
  fs.realpathSync(root) !== root
)
  throw new Error("source checkout must be a real, canonical absolute path");
const revision = args.get("required-head");
if (!/^[a-f0-9]{40}$/u.test(revision))
  throw new Error("expected checkout revision must be a full Git SHA");
const git = (...commands) =>
  execFileSync("git", ["-C", root, ...commands], { encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== revision)
  throw new Error("checkout is not at the requested Git revision");
if (
  git(
    "status",
    "--porcelain=v1",
    "--untracked-files=no",
    "--",
    "deepwell",
    "framerail",
    "locales",
    ".cargo",
    "install/local",
  )
)
  throw new Error("checkout contains modified tracked runtime source");
const project = isolatedStackProject(args.get("namespace"));
const override = isolatedStackOverride(args.get("namespace"));
const tmp = fs.mkdtempSync(
  path.join(os.tmpdir(), "wikijump-isolated-stack-plan-"),
);
try {
  const overridePath = path.join(tmp, "override.yaml");
  fs.writeFileSync(overridePath, override, { flag: "wx" });
  const env = { ...process.env, DEEPWELL_RPC_TOKEN: "a".repeat(64) };
  const composeArgs = [
    "compose",
    "--project-name",
    project,
    "--file",
    path.join(root, "install/local/docker-compose.yaml"),
    "--file",
    path.join(root, "install/local/docker-compose.dev.yaml"),
    "--file",
    overridePath,
    "config",
    "--format",
    "json",
  ];
  const raw = execFileSync("docker", composeArgs, {
    env,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const result = verifyIsolatedCompose(JSON.parse(raw), {
    namespace: args.get("namespace"),
    sourceRoot: root,
  });
  if (args.get("write") === "true") {
    const outputDir = path.resolve(args.get("output-dir"));
    if (
      outputDir !== args.get("output-dir") ||
      outputDir === root ||
      outputDir.startsWith(`${root}/`)
    )
      throw new Error(
        "generated Compose override must be outside the source checkout",
      );
    if (fs.existsSync(outputDir) && fs.realpathSync(outputDir) !== outputDir)
      throw new Error(
        "generated Compose output directory may not be a symlink",
      );
    fs.mkdirSync(outputDir, { recursive: true });
    const outputFile = path.join(outputDir, `${project}.yaml`);
    fs.writeFileSync(outputFile, override, { flag: "wx", mode: 0o444 });
    result.override_file = outputFile;
  }
  result.status =
    args.get("write") === "true"
      ? "written-no-containers-started"
      : "read-only-isolation-plan-pass";
  result.required_git_head = revision;
  console.log(JSON.stringify(result, null, 2));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
