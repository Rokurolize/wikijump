import {codePointCompare} from "./canonical-json.mjs";

export const CANDIDATE_ROW_MAP_SCHEMA = "wikijump.compatibility_candidate_row_proof_map.v1";

function fail(message) {
  throw new Error(message);
}

export function buildCandidateRowProofMap({inventory, ledger, denominator, aggregate, aggregateReference}) {
  if (inventory?.schema !== "wikijump.compatibility_surface_inventory.v2") fail("unsupported compatibility inventory");
  if (ledger?.schema !== "wikijump.compatibility_ledger.v1") fail("unsupported compatibility ledger");
  if (denominator?.schema !== "wikijump.compatibility_final_zero_denominator.v1" || denominator.status !== "sealed") fail("current denominator is not sealed");
  if (aggregate?.schema !== "wikijump.candidate_campaign_aggregate.v1" || aggregate.status !== "pass") fail("candidate campaign aggregate is not passing");
  if (aggregate.candidate?.wikijump_commit !== ledger.inputs?.wikijump?.commit || aggregate.candidate?.wikijump_tree !== ledger.inputs?.wikijump?.tree || aggregate.candidate?.ftml_sha !== ledger.inputs?.ftml?.commit) fail("candidate campaign aggregate source identity does not match the current ledger");
  if (!aggregateReference || !/^[0-9a-f]{64}$/u.test(aggregateReference.sha256 ?? "")) fail("candidate campaign aggregate reference is not immutable");

  const inventoryById = new Map(inventory.surfaces.map((row) => [row.surface_id, row]));
  const cases = new Map((aggregate.cases ?? []).map((row) => [row.case_id, row]));
  const blocked = [];
  const rows = denominator.rows.map((row) => {
    const record = inventoryById.get(row.source_local_id);
    if (!record || record.kind !== row.kind) fail(`candidate denominator row is not in the inventory: ${row.source_local_id}`);
    if (["blocked", "failed"].includes(record.candidate?.status)) {
      blocked.push(row.source_local_id);
      return null;
    }
    const exact = (record.existing_refs?.cases ?? []).flatMap((caseId) => {
      const candidate = cases.get(caseId);
      return candidate ? [{case_id: caseId, path: candidate.path, sha256: candidate.sha256}] : [];
    });
    return {
      surface_id: row.surface_id,
      source_local_id: row.source_local_id,
      kind: row.kind,
      basis: exact.length > 0 ? "exact_candidate_case" : "sealed_candidate_identity",
      artifacts: exact.length > 0 ? exact.map(({path, sha256}) => ({path, sha256})) : [aggregateReference],
    };
  });
  if (blocked.length > 0) fail(`candidate row mapping is blocked by ${blocked.length} current rows: ${blocked.slice(0, 8).join(", ")}`);
  if (rows.some((row) => row === null) || rows.length !== denominator.rows.length) fail("candidate row map is incomplete");
  return {
    schema: CANDIDATE_ROW_MAP_SCHEMA,
    status: "pass",
    run_id: aggregate.run_id,
    candidate: aggregate.candidate,
    aggregate: aggregateReference,
    rows: rows.sort((left, right) => codePointCompare(left.surface_id, right.surface_id)),
  };
}

