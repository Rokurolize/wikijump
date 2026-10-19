// Fixture provisioning writes to a database. Never allow a task-owned
// acceptance run to silently fall back to the shared development RPC port.
const SHARED_RPC = "http://127.0.0.1:2747/jsonrpc";

export function fixtureRpcTarget(env = process.env) {
  const project = env.THEME_LAB_BACKEND_PROJECT;
  const raw = env.DEEPWELL_RPC_URL;
  if (project !== undefined) {
    if (
      env.THEME_LAB_FIXTURE_SCOPE !== undefined &&
      env.THEME_LAB_FIXTURE_SCOPE !== "isolated-task"
    )
      throw new Error("task fixture provisioning requires isolated-task scope");
    if (!/^wikijump-theme-lab-[a-z][a-z0-9-]{2,30}$/u.test(project))
      throw new Error("invalid task-owned Theme Lab backend project");
    const required = `http://${project}-deepwell-1:2747/jsonrpc`;
    if (raw !== required)
      throw new Error(
        `task-owned Theme Lab fixture provisioning requires the exact isolated Deepwell DNS target: ${required}`,
      );
    return { rpcUrl: required, project, scope: "isolated-task" };
  }
  if (env.THEME_LAB_FIXTURE_SCOPE !== "shared-development")
    throw new Error(
      "mutating shared-development fixtures require explicit THEME_LAB_FIXTURE_SCOPE=shared-development",
    );
  if (raw !== undefined && raw !== SHARED_RPC)
    throw new Error(
      "shared development fixtures cannot override the RPC destination without a task-owned backend project",
    );
  return {
    rpcUrl: SHARED_RPC,
    project: "wikijump-local-development",
    scope: "shared-development",
  };
}
