import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const HEX40 = /^[0-9a-f]{40}$/u;
const GIT_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  HOME: "/nonexistent",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
});

export function pinnedFtmlBytes({ revision, tree, sourcePath }) {
  if (!HEX40.test(revision) || !HEX40.test(tree)) {
    throw new Error("pinned FTML revision and tree must be full Git object IDs");
  }
  if (
    typeof sourcePath !== "string" ||
    sourcePath.length === 0 ||
    /[\0\r\n]/u.test(sourcePath) ||
    path.isAbsolute(sourcePath) ||
    sourcePath.split("/").includes("..")
  ) {
    throw new Error("pinned FTML source path must be repository-relative");
  }
  const root = process.env.WIKIJUMP_FTML_CHECKOUT
    ?? path.join(homedir(), ".cargo", "git", "checkouts", "ftml-a724b9bc9f2959c8", revision.slice(0, 7));
  if (!path.isAbsolute(root)) throw new Error("pinned FTML checkout path must be absolute");
  const observed = execFileSync("/usr/bin/git", ["-C", root, "rev-parse", `${revision}^{commit}`, `${revision}^{tree}`], {
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim().split(/\s+/u);
  if (observed[0] !== revision || observed[1] !== tree) {
    throw new Error("FTML repository does not contain the pinned revision and tree");
  }
  return execFileSync("/usr/bin/git", ["-C", root, "cat-file", "blob", `${revision}:${sourcePath}`], {
    env: GIT_ENVIRONMENT,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
