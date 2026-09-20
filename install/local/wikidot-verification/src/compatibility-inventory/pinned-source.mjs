import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function uniqueSortedStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value !== ""))].sort()
}

export function createPinnedSourceAccess({
  sourceInputs,
  readText,
  repositoryPath,
  gitExecutable,
  gitEnvironment,
  ftmlGitDir
}) {
  const PINNED_TEXT_CACHE = new Map()
  const PINNED_TREE_CACHE = new Map()

  function resolveGitObject(gitArguments, revision, label) {
    let value
    try {
      value = execFileSync(
        gitExecutable,
        ["--no-replace-objects", ...gitArguments, "rev-parse", "--verify", revision],
        { encoding: "utf8", env: gitEnvironment, stdio: ["ignore", "pipe", "ignore"] }
      ).trim()
    } catch {
      throw new Error(`cannot resolve ${label}: ${revision}`)
    }
    if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} is not a Git object`)
    return value
  }

  async function sourceProvenance(root, sourceRevision) {
    const manifestPath = "deepwell/Cargo.toml"
    const lockPath = "deepwell/Cargo.lock"
    const [manifest, lock] = await Promise.all([
      readText(root, manifestPath),
      readText(root, lockPath)
    ])
    const manifestRevision = /ftml\s*=\s*\{[^\n]*\brev\s*=\s*"([0-9a-f]{40})"/u.exec(manifest)?.[1]
    const lockRevision = /git\+https:\/\/github\.com\/Rokurolize\/ftml\?rev=([0-9a-f]{40})#([0-9a-f]{40})/u.exec(lock)
    if (!manifestRevision || !lockRevision || lockRevision[1] !== manifestRevision || lockRevision[2] !== manifestRevision) {
      throw new Error("Deepwell FTML manifest and lock identities do not match")
    }
    let wikijump = null
    if (sourceRevision !== null) {
      if (!/^[0-9a-f]{40}$/u.test(sourceRevision ?? "")) {
        throw new Error("Wikijump source revision must be an exact commit")
      }
      const wikijumpCommit = resolveGitObject(
        ["-C", root],
        `${sourceRevision}^{commit}`,
        "Wikijump commit"
      )
      if (wikijumpCommit !== sourceRevision) {
        throw new Error("Wikijump source revision does not resolve to itself")
      }
      wikijump = {
        commit: wikijumpCommit,
        tree: resolveGitObject(["-C", root], `${wikijumpCommit}^{tree}`, "Wikijump tree")
      }
    }
    const ftmlCommit = resolveGitObject(
      [`--git-dir=${ftmlGitDir}`],
      `${manifestRevision}^{commit}`,
      "FTML commit"
    )
    const ftmlTree = resolveGitObject(
      [`--git-dir=${ftmlGitDir}`],
      `${ftmlCommit}^{tree}`,
      "FTML tree"
    )
    return {
      wikijump,
      ftml: { commit: ftmlCommit, tree: ftmlTree }
    }
  }

  function parseGitLsTree(output, label) {
    const entries = new Map()
    for (const row of output.toString("utf8").split("\0").filter(Boolean)) {
      const match = /^(\d+) ([a-z]+) ([0-9a-f]{40})\t(.+)$/u.exec(row)
      if (!match || match[2] !== "blob") continue
      const [, , , oid, objectPath] = match
      if (entries.has(objectPath)) throw new Error(`${label} contains duplicate path: ${objectPath}`)
      entries.set(objectPath, oid)
    }
    return entries
  }

  function listGitTreeBlobs(gitArguments, revision, label) {
    const listing = spawnSync(
      gitExecutable,
      ["--no-replace-objects", ...gitArguments, "ls-tree", "-r", "-z", revision],
      {
        env: gitEnvironment,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"]
      }
    )
    if (listing.status !== 0 || listing.error) {
      throw new Error(`cannot list ${label}: ${listing.error?.message ?? listing.stderr?.toString("utf8").trim() ?? "unknown error"}`)
    }
    return parseGitLsTree(listing.stdout, label)
  }

  function readGitBlobBatch(gitArguments, requests, label) {
    if (requests.length === 0) return new Map()
    const child = spawnSync(
      gitExecutable,
      ["--no-replace-objects", ...gitArguments, "cat-file", "--batch"],
      {
        input: `${requests.map(({ oid }) => oid).join("\n")}\n`,
        env: gitEnvironment,
        maxBuffer: 128 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"]
      }
    )
    if (child.status !== 0 || child.error) {
      const detail = child.error?.message ?? child.stderr?.toString("utf8").trim() ?? "unknown error"
      throw new Error(`cannot read ${label}: ${detail}`)
    }
    const output = child.stdout
    const result = new Map()
    let offset = 0
    for (const request of requests) {
      const newline = output.indexOf(0x0a, offset)
      if (newline < 0) throw new Error(`${label} batch response ended before ${request.path}`)
      const header = output.subarray(offset, newline).toString("utf8")
      const match = /^([0-9a-f]{40}) blob (\d+)$/u.exec(header)
      if (!match || match[1] !== request.oid) {
        throw new Error(`${label} batch identity drift for ${request.path}`)
      }
      const size = Number(match[2])
      const start = newline + 1
      const end = start + size
      if (!Number.isSafeInteger(size) || end >= output.length || output[end] !== 0x0a) {
        throw new Error(`${label} batch payload is truncated for ${request.path}`)
      }
      result.set(request.path, Buffer.from(output.subarray(start, end)))
      offset = end + 1
    }
    if (offset !== output.length) throw new Error(`${label} batch response has trailing bytes`)
    return result
  }

  function readGitSpecBatch(gitArguments, specs, label) {
    const uniqueSpecs = [...new Set(specs)]
    if (uniqueSpecs.length === 0) return new Map()
    const child = spawnSync(
      gitExecutable,
      ["--no-replace-objects", ...gitArguments, "cat-file", "--batch"],
      {
        input: `${uniqueSpecs.join("\n")}\n`,
        env: gitEnvironment,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["pipe", "pipe", "pipe"]
      }
    )
    if (child.status !== 0 || child.error) {
      const detail = child.error?.message ?? child.stderr?.toString("utf8").trim() ?? "unknown error"
      throw new Error(`cannot read ${label}: ${detail}`)
    }
    const output = child.stdout
    const result = new Map()
    let offset = 0
    for (const spec of uniqueSpecs) {
      const newline = output.indexOf(0x0a, offset)
      if (newline < 0) throw new Error(`${label} batch response ended before ${spec}`)
      const header = output.subarray(offset, newline).toString("utf8")
      if (header === `${spec} missing`) throw new Error(`${label} is missing ${spec}`)
      const match = /^([0-9a-f]{40}) ([a-z]+) (\d+)$/u.exec(header)
      if (!match || match[2] !== "blob") throw new Error(`${label} is not a blob: ${spec}`)
      const size = Number(match[3])
      const start = newline + 1
      const end = start + size
      if (!Number.isSafeInteger(size) || end >= output.length || output[end] !== 0x0a) {
        throw new Error(`${label} batch payload is truncated for ${spec}`)
      }
      result.set(spec, Buffer.from(output.subarray(start, end)))
      offset = end + 1
    }
    if (offset !== output.length) throw new Error(`${label} batch response has trailing bytes`)
    return result
  }

  function verifyRegistryBlobs(root, sourceRevision) {
    if (sourceRevision === null) return
    const tree = listGitTreeBlobs(["-C", root], sourceRevision, "pinned Wikijump tree")
    const requests = [...sourceInputs.keys()].map((registryPath) => {
      const oid = tree.get(registryPath)
      if (!oid) throw new Error(`registry is missing from pinned revision: ${registryPath}`)
      return { path: registryPath, oid }
    })
    const blobs = readGitBlobBatch(["-C", root], requests, "pinned Wikijump registries")
    for (const [registryPath, source] of sourceInputs) {
      if (sha256(blobs.get(registryPath)) !== sha256(source)) {
        throw new Error(`registry blob drift: ${registryPath}`)
      }
    }
  }

  function preloadPinnedRevisionTexts(root, revision, sourcePaths) {
    if (revision === null) {
      for (const sourcePath of uniqueSortedStrings(sourcePaths)) {
        const key = `${root}\0WORKTREE\0${sourcePath}`
        if (PINNED_TEXT_CACHE.has(key)) continue
        let source = null
        try {
          source = readFileSync(repositoryPath(root, sourcePath), "utf8")
        } catch {
          source = null
        }
        PINNED_TEXT_CACHE.set(key, source)
      }
      return
    }
    const treeKey = `${root}\0${revision}`
    let tree = PINNED_TREE_CACHE.get(treeKey)
    if (!tree) {
      tree = listGitTreeBlobs(["-C", root], revision, `pinned source tree ${revision}`)
      PINNED_TREE_CACHE.set(treeKey, tree)
    }
    const requests = []
    for (const sourcePath of uniqueSortedStrings(sourcePaths)) {
      const key = `${root}\0${revision}\0${sourcePath}`
      if (PINNED_TEXT_CACHE.has(key)) continue
      const oid = tree.get(sourcePath)
      if (!oid) {
        PINNED_TEXT_CACHE.set(key, null)
        continue
      }
      requests.push({ path: sourcePath, oid })
    }
    const blobs = readGitBlobBatch(["-C", root], requests, `pinned source texts ${revision}`)
    for (const request of requests) {
      PINNED_TEXT_CACHE.set(
        `${root}\0${revision}\0${request.path}`,
        blobs.get(request.path)?.toString("utf8") ?? null
      )
    }
  }

  function pinnedRevisionText(root, revision, sourcePath) {
    const key = `${root}\0${revision ?? "WORKTREE"}\0${sourcePath}`
    if (PINNED_TEXT_CACHE.has(key)) return PINNED_TEXT_CACHE.get(key)
    preloadPinnedRevisionTexts(root, revision, [sourcePath])
    return PINNED_TEXT_CACHE.get(key) ?? null
  }

  function gitRevisionContains(root, revision, sourcePath, literal) {
    return pinnedRevisionText(root, revision, sourcePath)?.includes(literal) === true
  }

  return {
    ftmlGitDir,
    resolveGitObject,
    sourceProvenance,
    parseGitLsTree,
    listGitTreeBlobs,
    readGitBlobBatch,
    readGitSpecBatch,
    verifyRegistryBlobs,
    preloadPinnedRevisionTexts,
    pinnedRevisionText,
    gitRevisionContains
  }
}
