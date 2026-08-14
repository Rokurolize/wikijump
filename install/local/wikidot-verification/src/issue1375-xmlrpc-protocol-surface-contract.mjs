import { createHash } from "node:crypto"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
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
  "xmlrpc-gap:live-protocol-divergences-and-open-upper-bounds",
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
      "authenticated_witness",
      "authority_gaps",
      "historical_attribution",
      "issue",
      "protocol_evidence_bindings",
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
  exactIds(
    contract.protocol_evidence_bindings,
    "surface_id",
    EXPECTED_RECORD_IDS,
    "protocol evidence bindings"
  )
  exactIds(contract.sources, "source_id", EXPECTED_SOURCE_IDS, "contract sources")
  exactIds(contract.authority_gaps, "gap_id", EXPECTED_GAP_IDS, "authority gaps")

  const witness = contract.authenticated_witness
  exactKeys(
    witness,
    [
      "authority",
      "client",
      "endpoint",
      "missing_controls",
      "nonmutation_proof",
      "observations",
      "observed_date_utc",
      "source",
      "witness_id"
    ],
    "authenticated witness"
  )
  exactKeys(witness.client, ["modules", "runtime", "tls"], "authenticated witness client")
  exactKeys(
    witness.authority,
    [
      "credential_environment_variables",
      "credential_origin_path",
      "credential_origin_status",
      "mode",
      "scope",
      "secret_values_recorded"
    ],
    "authenticated witness authority"
  )
  exactKeys(witness.source, ["path", "repository_id", "revision", "sha256"], "witness source")
  exactKeys(
    witness.nonmutation_proof,
    ["cleanup_required", "content_downloads", "mutation_methods_called"],
    "authenticated witness nonmutation proof"
  )
  if (
    witness.witness_id !== "xmlrpc-live:authenticated-read-only:2026-08-14" ||
    witness.observed_date_utc !== "2026-08-14" ||
    witness.endpoint !== "https://www.wikidot.com/xml-rpc-api.php" ||
    witness.client.runtime !== "Python 3.12.3" ||
    witness.client.tls !== "OpenSSL 3.0.13" ||
    JSON.stringify(witness.client.modules) !== JSON.stringify(["http.client", "xmlrpc.client"]) ||
    witness.authority.mode !== "HTTP Basic authentication" ||
    witness.authority.scope !== "authenticated read-only XML-RPC" ||
    JSON.stringify(witness.authority.credential_environment_variables) !==
      JSON.stringify(["WIKIDOT_APP_NAME", "WIKIDOT_API_KEY"]) ||
    witness.authority.credential_origin_path !== null ||
    witness.authority.credential_origin_status !== "not observed" ||
    witness.authority.secret_values_recorded !== false ||
    witness.source.repository_id !== "scp-wiki-translation" ||
    witness.source.revision !== "58b996999930e88dec937db5eaa6363c94b48b8e" ||
    witness.source.path !== "scripts/WIKIDOT_API.md" ||
    witness.source.sha256 !== "8f806c84032dd3e6067d2357b20f6f36d0ccc102623ac37b7ed4f1bed9314207" ||
    witness.nonmutation_proof.content_downloads !== 0 ||
    witness.nonmutation_proof.cleanup_required !== false ||
    JSON.stringify(witness.nonmutation_proof.mutation_methods_called) !== "[]"
  ) {
    throw new Error("authenticated witness identity is invalid")
  }

  const forbiddenSecretKeys = new Set([
    "api_key",
    "authorization",
    "credential_value",
    "password",
    "raw_auth_header",
    "secret"
  ])
  const inspectKeys = (value) => {
    if (!value || typeof value !== "object") return
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenSecretKeys.has(key.toLowerCase())) {
        throw new Error("authenticated witness contains secret-bearing fields")
      }
      inspectKeys(child)
    }
  }
  inspectKeys(witness)

  if (!Array.isArray(witness.observations) || !Array.isArray(witness.missing_controls)) {
    throw new Error("authenticated witness evidence collections are invalid")
  }
  const observationIds = []
  for (const observation of witness.observations) {
    exactKeys(
      observation,
      ["normalized", "observation_id", "request", "response"],
      "live observation"
    )
    exactKeys(
      observation.response,
      ["body_bytes", "body_sha256", "content_type", "http_status"],
      observation.observation_id
    )
    if (
      typeof observation.observation_id !== "string" ||
      !observation.observation_id.startsWith("xmlrpc-live:") ||
      typeof observation.request !== "string" ||
      observation.request.length === 0 ||
      (observation.response.http_status !== null &&
        !Number.isInteger(observation.response.http_status)) ||
      (observation.response.body_bytes !== null &&
        (!Number.isInteger(observation.response.body_bytes) || observation.response.body_bytes < 0)) ||
      (observation.response.body_sha256 !== null &&
        !/^[a-f0-9]{64}$/u.test(observation.response.body_sha256))
    ) {
      throw new Error(`live observation is invalid: ${observation.observation_id}`)
    }
    observationIds.push(observation.observation_id)
  }
  if (new Set(observationIds).size !== observationIds.length) {
    throw new Error("live observation IDs must be unique")
  }

  const missingControlIds = []
  for (const control of witness.missing_controls) {
    exactKeys(control, ["control_id", "reason", "required_authority"], "missing control")
    if (
      typeof control.control_id !== "string" ||
      !control.control_id.startsWith("xmlrpc-missing:") ||
      typeof control.reason !== "string" ||
      control.reason.length === 0 ||
      typeof control.required_authority !== "string" ||
      control.required_authority.length === 0
    ) {
      throw new Error(`missing control is invalid: ${control.control_id}`)
    }
    missingControlIds.push(control.control_id)
  }
  if (new Set(missingControlIds).size !== missingControlIds.length) {
    throw new Error("missing control IDs must be unique")
  }

  const observationIdSet = new Set(observationIds)
  const missingControlIdSet = new Set(missingControlIds)
  const boundObservationIds = []
  const boundMissingControlIds = []
  for (const binding of contract.protocol_evidence_bindings) {
    exactKeys(
      binding,
      ["missing_control_ids", "observation_ids", "source_only_reason", "surface_id"],
      `evidence binding ${binding.surface_id}`
    )
    if (!Array.isArray(binding.observation_ids) || !Array.isArray(binding.missing_control_ids)) {
      throw new Error(`evidence binding is invalid: ${binding.surface_id}`)
    }
    for (const observationId of binding.observation_ids) {
      if (!observationIdSet.has(observationId)) {
        throw new Error(`binding refers to an unknown live observation: ${observationId}`)
      }
      boundObservationIds.push(observationId)
    }
    for (const controlId of binding.missing_control_ids) {
      if (!missingControlIdSet.has(controlId)) {
        throw new Error(`binding refers to an unknown missing control: ${controlId}`)
      }
      boundMissingControlIds.push(controlId)
    }
    const hasSourceOnlyReason =
      typeof binding.source_only_reason === "string" && binding.source_only_reason.length > 0
    if (
      binding.source_only_reason !== null && !hasSourceOnlyReason ||
      (binding.observation_ids.length === 0 &&
        binding.missing_control_ids.length === 0 &&
        !hasSourceOnlyReason)
    ) {
      throw new Error(`evidence binding is invalid: ${binding.surface_id}`)
    }
  }
  if (
    JSON.stringify([...boundObservationIds].sort()) !== JSON.stringify([...observationIds].sort())
  ) {
    throw new Error("live observations must be bound exactly once")
  }
  if (
    JSON.stringify([...boundMissingControlIds].sort()) !==
    JSON.stringify([...missingControlIds].sort())
  ) {
    throw new Error("missing controls must be bound exactly once")
  }

  const repositoryIds = contract.repositories.map((repository) => repository.repository_id)
  if (
    contract.repositories.length !== 1 ||
    repositoryIds[0] !== "wikijump"
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
    const isApiSnapshot = source.source_id === "wikidot-api-reference"
    exactKeys(source, isApiSnapshot
      ? ["anchor", "git_blob_sha1", "path", "repository_id", "sha256", "source_id", "upstream"]
      : ["anchor", "path", "repository_id", "sha256", "source_id"], `source ${source.source_id}`)
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
    if (isApiSnapshot) {
      exactKeys(
        source.upstream,
        ["path", "repository", "revision", "sha256"],
        "Wikidot API snapshot upstream provenance"
      )
      if (
        source.repository_id !== "wikijump" ||
        source.git_blob_sha1 !== "2296e55b5357619e5563b88f4af7272426ee94fc" ||
        source.upstream.repository !== "Rokurolize/scp-wiki-translation" ||
        source.upstream.revision !== "58b996999930e88dec937db5eaa6363c94b48b8e" ||
        source.upstream.path !== "scripts/WIKIDOT_API.md" ||
        source.upstream.sha256 !== source.sha256
      ) {
        throw new Error("Wikidot API snapshot provenance is invalid")
      }
      const snapshotPath = `${repository.root}/${source.path}`
      try {
        bytes = await readFile(snapshotPath)
        const { stdout: blobSha1 } = await execFileAsync(
          "/usr/bin/git",
          ["-C", repository.root, "-c", "safe.directory=*", "hash-object", "--no-filters", source.path],
          { encoding: "utf8", env: GIT_ENV, maxBuffer: 1024 }
        )
        if (blobSha1.trim() !== source.git_blob_sha1) throw new Error("blob mismatch")
      } catch {
        throw new Error("source drift: wikidot-api-reference")
      }
    } else {
      try {
        ;({ stdout: bytes } = await execFileAsync(
          "/usr/bin/git",
          ["-C", repository.root, "-c", "safe.directory=*", "cat-file", "blob", `${repository.revision}:${source.path}`],
          { encoding: "buffer", env: GIT_ENV, maxBuffer: 8 * 1024 * 1024 }
        ))
      } catch {
        throw new Error(`source blob is unavailable: ${source.source_id}`)
      }
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
    live_observation_count: witness.observations.length,
    missing_control_count: witness.missing_controls.length,
    protocol_record_count: contract.protocol_records.length,
    source_count: contract.sources.length
  }
}
