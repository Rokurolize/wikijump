import { requireDeepwellRuntimeIdentity } from "./deepwell-runtime-identity.mjs";
import { requireRuntimeSourceSha } from "./runtime-source-identity.mjs";

// Produce a new *capture input* from a measured running backend, never by
// editing the October 7 receipt or blessing the candidate's old observations.
// The caller separately verifies the running container and source checkout.
export function prepareCurrentRuntimeContract(
  template,
  { runId, port, framerailSourceSha, backendRuntimeIdentity },
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
  return {
    ...structuredClone(template),
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
