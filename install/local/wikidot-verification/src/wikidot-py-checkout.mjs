import {spawnSync} from "node:child_process"
import path from "node:path"

const gitEnvironment = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin"
})

export function resolveWikidotPyCheckout(repositoryRoot, override = process.env.WIKIDOT_PY_CHECKOUT) {
  if (typeof override === "string" && override.trim() !== "") return path.resolve(override)

  const result = spawnSync(
    "/usr/bin/git",
    ["-C", repositoryRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    {encoding: "utf8", env: gitEnvironment}
  )
  if (result.status !== 0) throw new Error("cannot resolve the Wikijump primary Git checkout")
  const commonDirectory = result.stdout.trim()
  if (path.basename(commonDirectory) !== ".git") {
    throw new Error("Wikijump Git common directory is not a normal checkout")
  }
  return path.join(path.dirname(path.dirname(commonDirectory)), "wikidot.py")
}
