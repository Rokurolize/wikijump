import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireDeepwellRuntimeIdentity } from "./deepwell-runtime-identity.mjs";
import { requireRuntimeSourceSha } from "./runtime-source-identity.mjs";
import { validatePublicationCandidateSet } from "./publication-candidate-freeze.mjs";

const THEME_LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Produce a new *capture input* from a measured running backend, never by
// editing the October 7 receipt or blessing the candidate's old observations.
// The caller separately verifies the running container and source checkout.
//
// candidate_set_sha256 is read from the committed frozen candidate set, not
// carried from the template. The set must pass validatePublicationCandidateSet,
// or the contract is refused. candidateSet.root and candidateSet.validate exist
// for tests.
export function prepareCurrentRuntimeContract(
  template,
  { runId, port, framerailSourceSha, backendRuntimeIdentity, candidateSet = {} },
) {
  if (
    template?.schema !== "scp_jp_interactive_acceptance_run.v1" ||
    template?.baseline_theme?.name !== "Sigma-9" ||
    template?.target_site?.slug !== "scpaiueouiuiuiui" ||
    !Array.isArray(template?.browser_engines) ||
    !["chromium", "firefox", "webkit"].every((engine) =>
      template.browser_engines.includes(engine),
    )
  ) {
    throw new Error(
      "template is not the maintained Sigma-9 current acceptance contract",
    );
  }
  if (typeof runId !== "string" || !/^[a-z][a-z0-9-]{2,55}$/u.test(runId))
    throw new Error("run ID must be an isolated lowercase task ID");
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    port === 3395 ||
    port === 18443
  )
    throw new Error("capture port must be a unique task-owned TCP port");
  requireRuntimeSourceSha(
    framerailSourceSha,
    "current measured Framerail source",
  );
  requireDeepwellRuntimeIdentity(
    backendRuntimeIdentity,
    "current measured Deepwell runtime",
  );
  const root = candidateSet.root ?? THEME_LAB;
  const validate = candidateSet.validate ?? validatePublicationCandidateSet;
  const frozen = JSON.parse(
    fs.readFileSync(path.join(root, "publication", "frozen-candidate-set.json"), "utf8"),
  );
  if (typeof frozen.candidate_set_sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(frozen.candidate_set_sha256))
    throw new Error("frozen candidate set has no valid candidate_set_sha256");
  const failures = validate(root, { expectedCandidateSetSha256: frozen.candidate_set_sha256 });
  if (failures.length)
    throw new Error(
      `run contract refused: the frozen candidate set does not validate (${failures.length} failures; first: ${failures[0]})`,
    );
  return {
    ...structuredClone(template),
    candidate_set_sha256: frozen.candidate_set_sha256,
    expected_runtime_source_sha256: framerailSourceSha,
    expected_backend_runtime_identity: structuredClone(backendRuntimeIdentity),
    target_site: {
      ...template.target_site,
      origin: `https://scpaiueouiuiuiui.wikijump.localhost:${port}`,
    },
    artifact_namespace: `current-acceptance/sigma9/${runId}`,
    audit_path: `runs/${runId}/interactive-visual-audit.json`,
  };
}
