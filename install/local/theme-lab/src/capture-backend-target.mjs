import path from "node:path";

// The shared development capture measures the Deepwell Compose service owned by
// this checkout. A task-owned capture instead measures the isolated backend
// whose source mounts belong to a separate runtime checkout, so both values
// must be supplied together and are validated before any Docker inspection.
const TASK_PROJECT = /^wikijump-theme-lab-[a-z][a-z0-9-]{2,30}$/u;

export function resolveCaptureBackendTarget({
  runtimeRepo,
  backendProject,
  repoRoot,
}) {
  if (runtimeRepo === undefined && backendProject === undefined)
    return { root: repoRoot, identityOptions: undefined };
  if (runtimeRepo === undefined || backendProject === undefined)
    throw new Error(
      "--runtime-repo and --backend-project must be supplied together",
    );
  if (!path.isAbsolute(runtimeRepo) || path.resolve(runtimeRepo) !== runtimeRepo)
    throw new Error("--runtime-repo must be a canonical absolute checkout path");
  if (!TASK_PROJECT.test(backendProject))
    throw new Error("--backend-project must be a task-owned Theme Lab Compose project");
  return {
    root: runtimeRepo,
    identityOptions: {
      containerName: `${backendProject}-deepwell-1`,
      composeProject: backendProject,
    },
  };
}
