import {codePointCompare} from "./canonical-json.mjs";

export const STANDING_MATRIX_SCHEMA = "wikijump.compatibility_standing_matrix.v2";

function fail(message) { throw new Error(message); }

export function buildStandingCompatibilityMatrix({ledger, denominator, promotion, promotionReference, refresh, refreshReference}) {
  if (ledger?.schema !== "wikijump.compatibility_ledger.v1") fail("unsupported post-merge ledger");
  if (denominator?.schema !== "wikijump.compatibility_final_zero_denominator.v1" || denominator.status !== "sealed") fail("current denominator is not sealed");
  if (promotion?.schema !== "wikijump.standing_promotion_precondition.v1" || promotion.status !== "pass") fail("promotion precondition is not passing");
  if (refresh?.schema_version !== 1 || refresh.kind !== "standing-promotion" || refresh.status !== "pass") fail("standing refresh is not passing");
  if (refresh.run_id !== promotion.run_id) fail("standing refresh run does not match promotion precondition");
  if (refresh.wikijump_sha !== ledger.inputs?.wikijump?.commit || refresh.wikijump_tree !== ledger.inputs?.wikijump?.tree) fail("standing refresh does not serve the post-merge ledger identity");
  if (refresh.ftml_sha !== ledger.inputs?.ftml?.commit) fail("standing refresh FTML identity differs from post-merge ledger");
  if (promotion.candidate?.wikijump_tree !== refresh.wikijump_tree) fail("normal merge tree differs from candidate tree");
  if (promotion.candidate?.wikijump_commit === refresh.wikijump_sha) fail("standing source is still the candidate PR head rather than a merge commit");
  if (refresh.promotion_precondition?.path !== promotionReference?.path || refresh.promotion_precondition?.sha256 !== promotionReference?.sha256) fail("standing refresh is not bound to the selected promotion precondition");
  for (const service of ["deepwell", "framerail", "wws"]) {
    if (promotion.build?.images?.[service] !== refresh.images?.[service]?.id) fail(`standing ${service} image is not the promoted candidate image`);
  }
  if (!/^[0-9a-f]{64}$/u.test(refreshReference?.sha256 ?? "")) fail("standing refresh reference is not immutable");
  return {
    schema: STANDING_MATRIX_SCHEMA,
    status: "pass",
    run_id: refresh.run_id,
    merge_commit: refresh.wikijump_sha,
    merge_tree: refresh.wikijump_tree,
    ftml_sha: refresh.ftml_sha,
    ftml_tree: ledger.inputs.ftml.tree,
    candidate_commit: promotion.candidate.wikijump_commit,
    candidate_artifact_key: promotion.candidate.artifact_key,
    promotion_precondition: promotionReference,
    standing_refresh: refreshReference,
    rows: denominator.rows
      .map((row) => ({
        surface_id: row.surface_id,
        source_local_id: row.source_local_id,
        kind: row.kind,
        status: "pass",
        artifacts: [refreshReference],
      }))
      .sort((left, right) => codePointCompare(left.surface_id, right.surface_id)),
  };
}

