// Resolves the logical (run-contract) origin and the transport origin that the
// interactive capture talks to. The shared development flow keeps its fixed
// logical origin; a task-owned flow binds the contract's own origin to the
// transport origin so a contract for one port cannot be replayed on another.
export const SHARED_LOGICAL_ORIGIN =
  "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const AUTHORIZED_HOST = "scpaiueouiuiuiui.wikijump.localhost";

function strictOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== AUTHORIZED_HOST ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${label} must be an HTTPS origin on the authorized local authoring hostname`,
    );
  return url.origin;
}

export function resolveFixtureOrigins({ contractOrigin, transportOrigin }) {
  if (typeof contractOrigin !== "string" || contractOrigin === "")
    throw new Error("acceptance run contract needs target_site.origin");
  if (contractOrigin === SHARED_LOGICAL_ORIGIN) {
    // Shared development contract: unchanged behavior, with an optional
    // built-transport origin that only needs to be a local authoring origin.
    const origin =
      transportOrigin === undefined
        ? SHARED_LOGICAL_ORIGIN
        : strictOrigin(transportOrigin, "transport origin");
    return { logicalOrigin: SHARED_LOGICAL_ORIGIN, origin };
  }
  if (transportOrigin === undefined)
    throw new Error(
      "acceptance run contract origin does not match the fixture target",
    );
  const logicalOrigin = strictOrigin(
    contractOrigin,
    "acceptance run contract origin",
  );
  const origin = strictOrigin(transportOrigin, "transport origin");
  if (logicalOrigin !== contractOrigin || logicalOrigin !== origin)
    throw new Error(
      "acceptance run contract origin does not match the fixture target",
    );
  return { logicalOrigin, origin };
}
