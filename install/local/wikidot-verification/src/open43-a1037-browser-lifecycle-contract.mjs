import { requireNonEmptyString, requirePlainObject } from "./standing-browser-parity-util.mjs";

export const OPEN43_A1037_BROWSER_LIFECYCLE_SCHEMA = "wikijump.open43_a1037_browser_lifecycle_receipt.v1";

const REQUIRED_STAGES = Object.freeze([
  "initial_dom",
  "submit",
  "success",
  "error",
  "reload",
  "history",
  "focus",
  "keyboard",
  "repeated_submission",
]);

function requirePass(value, name) {
  const object = requirePlainObject(value, name);
  if (object.status !== "pass") throw new Error(`${name} is not a passing authority receipt`);
  return object;
}

function requirePositiveAuthority(receipt) {
  if (!(["mailform", "simpletodo"].includes(receipt.lane))) throw new Error("A1037 browser lane is unsupported");
  const authority = requirePlainObject(receipt.positive_authority, "A1037 positive authority");
  const row = requirePass(authority[receipt.lane], `A1037 ${receipt.lane} positive authority`);
  if (row.cleanup?.status !== "pass") throw new Error(`A1037 ${receipt.lane} positive authority cleanup is not passing`);
}

function requireStageRows(module, name) {
  const stages = requirePlainObject(module.stages, `${name} stages`);
  for (const stage of REQUIRED_STAGES) {
    const row = requirePlainObject(stages[stage], `${name} ${stage}`);
    if (row.observed !== true) throw new Error(`${name} ${stage} was not observed`);
    if (!Number.isSafeInteger(row.request_count) || row.request_count < 0) throw new Error(`${name} ${stage} request count is invalid`);
  }
}

export function verifyOpen43A1037BrowserLifecycleReceipt(value, { runId, pageSlug } = {}) {
  const receipt = requirePlainObject(value, "A1037 browser lifecycle receipt");
  if (receipt.schema !== OPEN43_A1037_BROWSER_LIFECYCLE_SCHEMA || receipt.status !== "pass" || receipt.closure !== "closed") {
    throw new Error("A1037 browser lifecycle receipt is not closed and passing");
  }
  if (runId !== undefined && receipt.run_id !== runId) throw new Error("A1037 browser lifecycle run identity drifted");
  if (pageSlug !== undefined && receipt.page_slug !== pageSlug) throw new Error("A1037 browser lifecycle page identity drifted");
  if (!/^[0-9a-f]{64}$/u.test(receipt.browser_identity_sha256 ?? "")) throw new Error("A1037 browser identity is malformed");
  requirePositiveAuthority(receipt);
  const modules = requirePlainObject(receipt.modules, "A1037 browser modules");
  requireStageRows(modules[receipt.lane], `A1037 ${receipt.lane}`);
  const cleanup = requirePass(receipt.cleanup, "A1037 browser cleanup");
  for (const key of ["pages_closed", "contexts_closed", "storage_states_removed", "request_gate_closed", "run_owned_page_absent"]) {
    if (cleanup[key] !== true) throw new Error(`A1037 browser cleanup did not prove ${key}`);
  }
  if (receipt.unexpected_mutation_count !== 0 || receipt.unexpected_external_request_count !== 0) {
    throw new Error("A1037 browser lifecycle receipt contains unexpected requests");
  }
  return {
    verified: true,
    positive_authority_verified: true,
    module_stage_count: REQUIRED_STAGES.length,
    cleanup_verified: true,
  };
}
