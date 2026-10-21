// A task-owned built Framerail sidecar normally inherits the dev image's
// FRAMERAIL_ENV=local, under which anonymous mutations on the editable site
// `scpaiueouiuiuiui` resolve to the local administrator (#2131). Guest-denial
// states (for example dialog.generic.edit-permission-error) are only
// observable when guests lack edit rights, i.e. a non-local deployment
// environment. The override is limited to task-owned backends so the shared
// development transport always keeps its own environment.
const ALLOWED = new Set(["local", "dev", "prod"]);

export function parseFramerailEnvOption({ framerailEnv, backendProject }) {
  if (framerailEnv === undefined || framerailEnv === null) return null;
  if (!backendProject)
    throw new Error("--framerail-env is only allowed for a task-owned --backend-project");
  if (!ALLOWED.has(framerailEnv))
    throw new Error("--framerail-env must be local, dev, or prod");
  return framerailEnv;
}

export function framerailEnvLabel(framerailEnv) {
  return framerailEnv ?? "image-default";
}
