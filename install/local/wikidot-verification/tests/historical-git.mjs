import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url))
const environment = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  HOME: "/nonexistent",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin"
})

export function historicalBytes(revision, relativePath) {
  if (!/^[0-9a-f]{40}$/u.test(revision) || typeof relativePath !== "string" || /[\0\r\n]/u.test(relativePath) || relativePath.startsWith("/") || relativePath.split("/").includes("..")) {
    throw new Error("invalid historical source identity")
  }
  const resolution = spawnSync(
    "/usr/bin/git",
    ["-C", repositoryRoot, "rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`],
    { encoding: "utf8", env: environment }
  )
  if (resolution.status !== 0 || resolution.stdout.trim() !== revision) {
    throw new Error("historical revision must resolve as the exact commit")
  }
  return execFileSync(
    "/usr/bin/git",
    ["-C", repositoryRoot, "cat-file", "blob", `${revision}:${relativePath}`],
    { env: environment, maxBuffer: 8 * 1024 * 1024 }
  )
}

export const historicalText = (revision, relativePath) => historicalBytes(revision, relativePath).toString("utf8")
export const historicalSha256 = (revision, relativePath) => createHash("sha256").update(historicalBytes(revision, relativePath)).digest("hex")
