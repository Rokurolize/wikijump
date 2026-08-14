import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const GIT_ENV = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_OPTIONAL_LOCKS: "0",
  HOME: "/nonexistent",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin"
})

const EXPECTED_RECORD_IDS = [
  "xmlrpc-protocol:authentication-boundary:http-basic",
  "xmlrpc-protocol:authentication-boundary:actor-login",
  "xmlrpc-protocol:multicall-boundary:valid",
  "xmlrpc-protocol:multicall-boundary:invalid-child",
  "xmlrpc-protocol:multicall-boundary:nested",
  "xmlrpc-protocol:multicall-boundary:count",
  "xmlrpc-protocol:fault-boundary:xml",
  "xmlrpc-protocol:fault-boundary:http",
  "xmlrpc-protocol:resource-boundary:body-bytes",
  "xmlrpc-protocol:resource-boundary:value-depth",
  "xmlrpc-protocol:resource-boundary:node-budget",
  "xmlrpc-protocol:resource-boundary:filter-count",
  "xmlrpc-protocol:resource-boundary:file-bytes",
  "xmlrpc-protocol:resource-boundary:upload-timeout",
  "xmlrpc-protocol:persistence-boundary:page",
  "xmlrpc-protocol:persistence-boundary:file"
]
const EXPECTED_SOURCE_IDS = [
  "framerail-authentication",
  "framerail-handler",
  "framerail-methods",
  "framerail-protocol",
  "framerail-resources",
  "framerail-api-tests",
  "framerail-size-tests",
  "framerail-page-identity-tests",
  "framerail-file-lifecycle-tests",
  "framerail-page-slug-tests",
  "historical-pr1334-attribution",
  "wikidot-api-reference"
]
const EXPECTED_GAP_IDS = [
  "xmlrpc-gap:authenticated-wikidot-protocol-observation",
  "xmlrpc-gap:run-owned-page-persistence",
  "xmlrpc-gap:run-owned-file-persistence"
]

function exactKeys(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) {
    throw new Error(`${label} has an invalid shape`)
  }
}

function exactIds(records, key, expected, label) {
  if (
    !Array.isArray(records) ||
    records.length !== expected.length ||
    JSON.stringify(records.map((record) => record?.[key]).sort()) !==
      JSON.stringify([...expected].sort())
  ) {
    throw new Error(`${label} must contain each expected surface exactly once`)
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export async function verifyIssue1375XmlRpcProtocolSurfaceContract(
  contract,
  { repositories }
) {
  exactKeys(
    contract,
    [
      "authority_gaps",
      "historical_attribution",
      "issue",
      "protocol_records",
      "repositories",
      "schema",
      "sources"
    ],
    "issue #1375 XML-RPC protocol contract"
  )
  if (
    contract.schema !== "wikijump.issue1375.xmlrpc_protocol_surface_contract.v1" ||
    contract.issue !== 1375
  ) {
    throw new Error("issue #1375 XML-RPC protocol contract identity is invalid")
  }

  exactIds(contract.protocol_records, "surface_id", EXPECTED_RECORD_IDS, "protocol records")
  exactIds(contract.sources, "source_id", EXPECTED_SOURCE_IDS, "contract sources")
  exactIds(contract.authority_gaps, "gap_id", EXPECTED_GAP_IDS, "authority gaps")

  const repositoryIds = contract.repositories.map((repository) => repository.repository_id)
  if (
    contract.repositories.length !== 2 ||
    new Set(repositoryIds).size !== 2 ||
    repositoryIds.some((id) => !["wikijump", "scp-wiki-translation"].includes(id))
  ) {
    throw new Error("contract repositories are invalid")
  }
  const resolvedRepositories = new Map()
  for (const repository of contract.repositories) {
    exactKeys(repository, ["repository_id", "revision"], `repository ${repository.repository_id}`)
    if (
      !/^[a-f0-9]{40}$/u.test(repository.revision) ||
      !(repository.repository_id in repositories)
    ) {
      throw new Error(`source revision is unavailable: ${repository.repository_id}`)
    }
    const root = fileURLToPath(repositories[repository.repository_id])
    try {
      const { stdout } = await execFileAsync(
        "/usr/bin/git",
        ["-C", root, "-c", "safe.directory=*", "rev-parse", "--verify", `${repository.revision}^{commit}`],
        { encoding: "utf8", env: GIT_ENV, maxBuffer: 1024 }
      )
      if (stdout.trim() !== repository.revision) throw new Error("revision mismatch")
    } catch {
      throw new Error(`source revision is unavailable: ${repository.repository_id}`)
    }
    resolvedRepositories.set(repository.repository_id, { revision: repository.revision, root })
  }

  const sources = new Map(contract.sources.map((source) => [source.source_id, source]))
  const sourceBytes = new Map()
  for (const source of contract.sources) {
    exactKeys(
      source,
      ["anchor", "path", "repository_id", "sha256", "source_id"],
      `source ${source.source_id}`
    )
    if (
      !sources.has(source.source_id) ||
      !repositoryIds.includes(source.repository_id) ||
      !/^[a-f0-9]{64}$/u.test(source.sha256) ||
      typeof source.anchor !== "string" ||
      source.anchor.length === 0 ||
      typeof source.path !== "string" ||
      source.path.startsWith("/") ||
      source.path.split("/").includes("..")
    ) {
      throw new Error(`source declaration is invalid: ${source.source_id}`)
    }
    const repository = resolvedRepositories.get(source.repository_id)
    let bytes
    try {
      ;({ stdout: bytes } = await execFileAsync(
        "/usr/bin/git",
        ["-C", repository.root, "-c", "safe.directory=*", "cat-file", "blob", `${repository.revision}:${source.path}`],
        { encoding: "buffer", env: GIT_ENV, maxBuffer: 8 * 1024 * 1024 }
      ))
    } catch {
      throw new Error(`source blob is unavailable: ${source.source_id}`)
    }
    if (sha256(bytes) !== source.sha256 || !bytes.toString("utf8").includes(source.anchor)) {
      throw new Error(`source drift: ${source.source_id}`)
    }
    sourceBytes.set(source.source_id, bytes)
  }

  for (const record of contract.protocol_records) {
    exactKeys(record, ["contract", "kind", "source_ids", "surface_id"], record.surface_id)
    if (
      !record.surface_id.includes(`:${record.kind}:`) ||
      typeof record.contract !== "string" ||
      record.contract.length === 0 ||
      !Array.isArray(record.source_ids) ||
      record.source_ids.length === 0 ||
      new Set(record.source_ids).size !== record.source_ids.length ||
      record.source_ids.some((sourceId) => !sources.has(sourceId))
    ) {
      throw new Error(`protocol record is invalid: ${record.surface_id}`)
    }
  }

  exactKeys(
    contract.historical_attribution,
    ["method_count", "record_count", "role", "source_id"],
    "historical attribution"
  )
  const historical = contract.historical_attribution
  const historicalArtifact = JSON.parse(sourceBytes.get(historical.source_id).toString("utf8"))
  if (
    historical.role !== "historical-source-attribution-only" ||
    historical.method_count !== 17 ||
    historical.record_count !== 31 ||
    historicalArtifact.surface_count !== 31 ||
    historicalArtifact.records?.length !== 31 ||
    historicalArtifact.counts?.xmlrpc_method_surfaces !== 17
  ) {
    throw new Error("historical 17-method/31-record attribution drift")
  }

  for (const gap of contract.authority_gaps) {
    exactKeys(gap, ["gap_id", "required_authority", "unverified_outcome"], gap.gap_id)
    if (
      !["authenticated-xmlrpc", "run-owned-persistence"].includes(gap.required_authority) ||
      typeof gap.unverified_outcome !== "string" ||
      gap.unverified_outcome.length === 0
    ) {
      throw new Error(`authority gap is invalid: ${gap.gap_id}`)
    }
  }

  return {
    authority_gap_count: contract.authority_gaps.length,
    historical_attribution: {
      method_count: historical.method_count,
      record_count: historical.record_count
    },
    protocol_record_count: contract.protocol_records.length,
    source_count: contract.sources.length
  }
}
