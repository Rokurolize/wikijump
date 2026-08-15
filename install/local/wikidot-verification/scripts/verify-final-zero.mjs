#!/usr/bin/env node

import {execFileSync} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import denominatorContract from "../../../../docs/development/compatibility-denominator-contract.json" with {type: "json"};

import {runCliIfMain} from "../src/cli-entry.mjs";
import {sealJsonNoReplace, sha256File} from "../src/standing-browser-parity-util.mjs";

const GIT = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const SURFACE = /^surface:[0-9]{8}$/u;
const INVENTORY_SCHEMA = "wikijump.compatibility_surface_inventory.v2";
const LEDGER_SCHEMA = "wikijump.compatibility_ledger.v1";
const DEFERRED_KINDS = Object.freeze([
  "framerail_xmlrpc_method",
  "wikidot_py_amc_module_shape",
]);
const DEFERRED_PREFIXES = Object.freeze([
  "framerail-xmlrpc:",
  "wikidot-py-",
]);
export const DEFERRED_SCOPE_ROWS = Object.freeze([
  ["framerail-xmlrpc:categories.select", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:files.get_meta", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:files.get_one", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:files.save_one", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:files.select", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:pages.get_meta", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:pages.get_one", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:pages.save_one", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:pages.select", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:posts.get", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:posts.select", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:system.listMethods", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:system.methodHelp", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:system.methodSignature", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:system.multicall", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:tags.select", "framerail_xmlrpc_method"],
  ["framerail-xmlrpc:users.get_me", "framerail_xmlrpc_method"],
  ["wikidot-py-amc-module:changes/SiteChangesListModule:parameters=options,page,perpage", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:dashboard/messages/DMInboxModule:parameters=page?", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:dashboard/messages/DMSentModule:parameters=page?", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:dashboard/messages/DMViewMessageModule:parameters=item", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:edit/EditMetaModule:parameters=pageId", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:files/PageFilesModule:parameters=page_id", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:forum/ForumCommentsListModule:parameters=pageId", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:forum/ForumStartModule:parameters=hidden", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:forum/ForumViewCategoryModule:parameters=c,p", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:forum/ForumViewThreadModule:parameters=t", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:forum/ForumViewThreadPostsModule:parameters=pageNo,t", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:forum/sub/ForumEditPostFormModule:parameters=postId,threadId", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:forum/sub/ForumPostRevisionModule:parameters=revisionId", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:forum/sub/ForumPostRevisionsModule:parameters=postId", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:history/PageRevisionListModule:parameters=options,page_id,perpage", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:history/PageSourceModule:parameters=revision_id", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:history/PageVersionModule:parameters=revision_id", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:list/ListPagesModule:parameters=module_body,p,pagetype,page_type,page-type,category,tags,tag,parent,created_at,createdat,updated_at,updatedat,created_by,createdby,rating,score,name,fullname,full_slug,fullslug,range,order,offset,limit,perpage,per_page,separate,wrapper,rss,rsstitle,rssdescription,rsshome,rsslimit,rssonly", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:managesite/ManageSiteMembersApplicationsModule:parameters=(none)", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:membership/MembersListModule:parameters=group,page", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:pagerate/WhoRatedPageModule:parameters=pageId", "wikidot_py_amc_module_shape"],
  ["wikidot-py-amc-module:viewsource/ViewSourceModule:parameters=page_id", "wikidot_py_amc_module_shape"],
]);
const DEFERRED_SCOPE_KINDS = new Map(DEFERRED_SCOPE_ROWS);
const FINAL_ZERO_CLASSES = Object.freeze(denominatorContract.vocabularies.final_zero_nonzero_classes);

function fail(message) {
  throw new Error(message);
}

function object(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${name} must be an object`);
  }
  return value;
}

function exactKeys(value, keys, name) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${name} has missing or unknown fields`);
  }
}

function enumValue(value, values, name) {
  if (!values.includes(value)) fail(`${name} has an unsupported value`);
}

function digest(value, name) {
  if (!SHA256.test(value ?? "")) fail(`${name} must be a SHA-256 digest`);
  if (/^(.)\1+$/u.test(value)) fail(`${name} must not be a placeholder identity`);
  return value;
}

function gitObject(value, name) {
  if (!GIT.test(value ?? "")) fail(`${name} must be a full lowercase Git object id`);
  if (/^(.)\1+$/u.test(value)) fail(`${name} must not be a placeholder identity`);
  return value;
}

function count(predicate, values) {
  return values.reduce((total, value) => total + (predicate(value) ? 1 : 0), 0);
}

function isDeferredScopeRow(row) {
  return DEFERRED_KINDS.includes(row.kind) || DEFERRED_PREFIXES.some((prefix) => row.source_local_id.startsWith(prefix));
}

function validateDenominator(value) {
  const denominator = object(value, "final-zero denominator");
  exactKeys(
    denominator,
    ["schema", "rows", "charter_requirements", "untyped_edge_count"],
    "final-zero denominator",
  );
  if (denominator.schema !== "wikijump.compatibility_final_zero_denominator.v1") {
    fail("final-zero denominator has an unsupported schema");
  }
  if (!Array.isArray(denominator.rows) || denominator.rows.length === 0) {
    fail("final-zero denominator rows must be non-empty");
  }
  if (!Number.isSafeInteger(denominator.untyped_edge_count) || denominator.untyped_edge_count < 0) {
    fail("final-zero denominator untyped_edge_count is invalid");
  }
  if (!Array.isArray(denominator.charter_requirements) || denominator.charter_requirements.length === 0) {
    fail("final-zero denominator charter_requirements must be non-empty");
  }
  const charterRequirements = denominator.charter_requirements.map((value, index) => {
    const requirement = object(value, `charter requirement ${index}`);
    exactKeys(requirement, ["id", "status"], `charter requirement ${index}`);
    if (typeof requirement.id !== "string" || requirement.id === "") fail(`charter requirement ${index}.id is invalid`);
    enumValue(requirement.status, ["represented", "missing"], `charter requirement ${index}.status`);
    return requirement;
  });
  if (new Set(charterRequirements.map(({id}) => id)).size !== charterRequirements.length) fail("final-zero denominator has duplicate charter requirements");
  const rows = denominator.rows.map((value, index) => {
    const row = object(value, `final-zero denominator row ${index}`);
    exactKeys(
      row,
      [
        "surface_id",
        "source_local_id",
        "kind",
        "identity",
        "public_surface",
        "owner",
        "source_provenance",
        "evidence",
        "source",
        "standards_review",
        "spec_review",
        "candidate",
        "standing",
        "closure",
        "issue",
        "charter",
      ],
      `final-zero denominator row ${index}`,
    );
    if (!SURFACE.test(row.surface_id ?? "")) fail(`row ${index} has an invalid surface_id`);
    if (typeof row.source_local_id !== "string" || row.source_local_id === "") fail(`row ${index} has an invalid source_local_id`);
    if (typeof row.kind !== "string" || row.kind === "") fail(`row ${index} has an invalid kind`);
    if (isDeferredScopeRow(row)) fail(`current final-zero denominator contains deferred scope row ${row.source_local_id}`);
    enumValue(row.identity, ["canonical", "ambiguous"], `row ${index}.identity`);
    for (const field of ["public_surface"]) {
      if (typeof row[field] !== "boolean") fail(`row ${index}.${field} must be boolean`);
    }
    for (const field of ["owner", "source_provenance", "evidence", "source", "standards_review", "spec_review", "candidate", "standing", "closure", "issue", "charter"]) {
      if (typeof row[field] !== "string" || row[field] === "") fail(`row ${index}.${field} must be a non-empty string`);
    }
    enumValue(row.owner, ["known", "unknown"], `row ${index}.owner`);
    enumValue(row.source_provenance, ["present", "missing", "stale"], `row ${index}.source_provenance`);
    enumValue(row.evidence, ["resolved", "unresolved"], `row ${index}.evidence`);
    enumValue(row.source, ["implemented", "unimplemented"], `row ${index}.source`);
    enumValue(row.standards_review, ["pass", "missing", "fail"], `row ${index}.standards_review`);
    enumValue(row.spec_review, ["pass", "missing", "fail"], `row ${index}.spec_review`);
    enumValue(row.candidate, ["pass", "missing", "fail"], `row ${index}.candidate`);
    enumValue(row.standing, ["pass", "missing", "fail"], `row ${index}.standing`);
    enumValue(row.closure, ["closed", "open"], `row ${index}.closure`);
    enumValue(row.issue, ["reconciled", "unreconciled"], `row ${index}.issue`);
    enumValue(row.charter, ["represented", "missing"], `row ${index}.charter`);
    return row;
  });
  const ids = rows.map((row) => row.surface_id);
  const sourceLocalIds = rows.map((row) => row.source_local_id);
  if (new Set(sourceLocalIds).size !== sourceLocalIds.length) fail("final-zero denominator has duplicate source-local identities");
  return {
    rows,
    ids,
    duplicateIds: ids.length - new Set(ids).size,
    charterRequirements,
    untypedEdgeCount: denominator.untyped_edge_count,
  };
}

function validateScopeRow(value, index, name) {
  const row = object(value, `${name} row ${index}`);
  exactKeys(row, ["source_local_id", "kind"], `${name} row ${index}`);
  if (typeof row.source_local_id !== "string" || row.source_local_id === "") {
    fail(`${name} row ${index}.source_local_id is invalid`);
  }
  const expectedKind = DEFERRED_SCOPE_KINDS.get(row.source_local_id);
  if (expectedKind === undefined) fail(`${name} row ${index} has an unknown deferred source-local identity`);
  if (row.kind !== expectedKind) fail(`${name} row ${index} has an invalid kind for its source-local identity`);
  return row;
}

function scopeKey(row) {
  return `${row.source_local_id}\u0000${row.kind}`;
}

function validateDeferredDenominator(value) {
  const denominator = object(value, "deferred denominator");
  exactKeys(denominator, ["schema", "rows"], "deferred denominator");
  if (denominator.schema !== "wikijump.compatibility_deferred_denominator.v1") {
    fail("deferred denominator has an unsupported schema");
  }
  if (!Array.isArray(denominator.rows) || denominator.rows.length !== DEFERRED_SCOPE_ROWS.length) {
    fail(`deferred denominator must contain the frozen ${DEFERRED_SCOPE_ROWS.length}-row union`);
  }
  const rows = denominator.rows.map((row, index) => validateScopeRow(row, index, "deferred denominator"));
  if (new Set(rows.map(({source_local_id}) => source_local_id)).size !== rows.length) {
    fail("deferred denominator has duplicate source-local identities");
  }
  if (JSON.stringify(rows.map(scopeKey).sort()) !== JSON.stringify(DEFERRED_SCOPE_ROWS.map(([source_local_id, kind]) => `${source_local_id}\u0000${kind}`).sort())) {
    fail("deferred denominator does not match the frozen canonical union");
  }
  return rows;
}

function reference(value, name) {
  const record = object(value, name);
  exactKeys(record, ["path", "sha256"], name);
  if (typeof record.path !== "string" || !path.isAbsolute(record.path)) fail(`${name}.path must be absolute`);
  digest(record.sha256, `${name}.sha256`);
  return record;
}

async function validateLedger(filePath, inventoryPath, denominatorRows) {
  const inventory = object(JSON.parse(await fs.readFile(inventoryPath, "utf8")), "frozen compatibility inventory");
  if (inventory.schema !== INVENTORY_SCHEMA) fail("frozen compatibility inventory has an unsupported schema");
  const inventoryRecords = [...(inventory.surfaces ?? []), ...(inventory.ftml_raw_surface_manifest?.records ?? [])];
  const inventoryByLocal = new Map(inventoryRecords.map((record) => [record.surface_id, record]));
  for (const row of denominatorRows) {
    const record = inventoryByLocal.get(row.source_local_id);
    if (record?.kind !== row.kind) fail(`final-zero denominator row ${row.surface_id} does not bind the frozen inventory ID/kind`);
  }
  const inventorySha256 = await sha256File(inventoryPath);
  const ledger = object(JSON.parse(await fs.readFile(filePath, "utf8")), "compatibility ledger");
  if (ledger.schema !== LEDGER_SCHEMA || !Array.isArray(ledger.rows) || !ledger.inputs) fail("compatibility ledger has an unsupported shape");
  const input = reference(ledger.inputs.inventory, "compatibility ledger inventory input");
  if (path.resolve(input.path) !== path.resolve(inventoryPath) || input.sha256 !== inventorySha256) fail("compatibility ledger does not bind the frozen inventory");
  const rows = ledger.rows.map((value, index) => {
    const row = object(value, `compatibility ledger row ${index}`);
    if (!SURFACE.test(row.surface_id ?? "")) fail(`compatibility ledger row ${index} has an invalid surface_id`);
    return row;
  });
  const ids = rows.map(({surface_id}) => surface_id);
  if (new Set(ids).size !== ids.length || JSON.stringify([...ids].sort()) !== JSON.stringify(denominatorRows.map(({surface_id}) => surface_id).sort())) fail("ledger surface IDs differ from the final-zero denominator");
  if (ledger.counts?.canonical_surfaces !== ids.length) fail("ledger canonical surface count is not exact");
  return {ledger, rows, bySurface: new Map(rows.map((row) => [row.surface_id, row]))};
}

async function validateDeferredLedger(filePath, expectedRows) {
  const ledger = object(JSON.parse(await fs.readFile(filePath, "utf8")), "deferred ledger");
  exactKeys(ledger, ["schema", "rows"], "deferred ledger");
  if (ledger.schema !== "wikijump.compatibility_deferred_ledger.v1") {
    fail("deferred ledger has an unsupported schema");
  }
  if (!Array.isArray(ledger.rows) || ledger.rows.length === 0) fail("deferred ledger rows must be non-empty");
  const rows = ledger.rows.map((row, index) => validateScopeRow(row, index, "deferred ledger"));
  if (new Set(rows.map(({source_local_id}) => source_local_id)).size !== rows.length) {
    fail("deferred ledger has duplicate source-local identities");
  }
  if (JSON.stringify(rows.map(scopeKey).sort()) !== JSON.stringify(expectedRows.map(scopeKey).sort())) {
    fail("deferred ledger does not exactly own the deferred denominator");
  }
  return ledger;
}

async function validateStandingMatrix(filePath, denominatorIds, canonical, repository) {
  const matrix = object(JSON.parse(await fs.readFile(filePath, "utf8")), "standing matrix");
  exactKeys(matrix, ["schema", "merge_commit", "rows"], "standing matrix");
  if (matrix.schema !== "wikijump.compatibility_standing_matrix.v1") fail("standing matrix has an unsupported schema");
  gitObject(matrix.merge_commit, "standing matrix merge_commit");
  const actualHead = execFileSync("git", ["-C", path.resolve(repository), "rev-parse", "HEAD^{commit}"], {encoding: "utf8"}).trim();
  if (actualHead !== matrix.merge_commit) fail("standing matrix merge_commit does not match the post-merge repository HEAD");
  if (!Array.isArray(matrix.rows)) fail("standing matrix rows must be an array");
  const rows = matrix.rows;
  const ids = rows.map((value, index) => {
    const row = object(value, `standing matrix row ${index}`);
    exactKeys(row, ["surface_id", "status", "artifacts"], `standing matrix row ${index}`);
    if (!SURFACE.test(row.surface_id ?? "")) fail(`standing matrix row ${index} has an invalid surface_id`);
    if (row.status !== "pass") fail(`standing matrix row ${index} is not a pass`);
    if (!Array.isArray(row.artifacts) || row.artifacts.length === 0) fail(`standing matrix row ${index} has no artifacts`);
    return row.surface_id;
  });
  if (new Set(ids).size !== ids.length) fail("standing matrix has duplicate surface ids");
  if (JSON.stringify([...ids].sort()) !== JSON.stringify(denominatorIds.sort())) fail("standing matrix surface ids differ from the final-zero denominator");
  await Promise.all(rows.flatMap((row, index) => row.artifacts.map(async (artifact, artifactIndex) => {
    const record = object(artifact, `standing matrix row ${index} artifact ${artifactIndex}`);
    exactKeys(record, ["path", "sha256"], `standing matrix row ${index} artifact ${artifactIndex}`);
    if (typeof record.path !== "string" || !path.isAbsolute(record.path)) fail("standing matrix artifacts must use absolute paths");
    const expected = digest(record.sha256, `standing matrix row ${index} artifact ${artifactIndex}.sha256`);
    const actual = await sha256File(record.path);
    if (actual !== expected) fail(`standing matrix row ${index} artifact ${artifactIndex} has a mismatched SHA-256`);
  })));
  for (const row of rows) {
    const canonicalRow = canonical.bySurface.get(row.surface_id);
    const expected = canonicalRow?.standing;
    if (expected?.state !== "pass" || !Array.isArray(expected.artifacts) || JSON.stringify(row.artifacts) !== JSON.stringify(expected.artifacts)) fail(`standing matrix row ${row.surface_id} artifacts do not bind the canonical ledger row`);
  }
  return matrix;
}

function finalZeroCounts(denominator) {
  const rows = denominator.rows;
  const counts = {
    complete_product_rows_open_or_unreconciled: count((row) => row.closure !== "closed" || row.issue !== "reconciled", rows),
    duplicate_or_ambiguous_canonical_identities: denominator.duplicateIds + count((row) => row.identity !== "canonical", rows),
    missing_independent_standards_or_spec_reviews: count((row) => row.standards_review !== "pass" || row.spec_review !== "pass", rows),
    missing_or_failing_candidate_proofs: count((row) => row.candidate !== "pass", rows),
    missing_or_failing_standing_proofs: count((row) => row.standing !== "pass", rows),
    missing_or_stale_source_provenance: count((row) => row.source_provenance !== "present", rows),
    missing_public_surfaces: count((row) => row.public_surface !== true, rows),
    unimplemented_source_required_rows: count((row) => row.source !== "implemented", rows),
    unknown_owners_or_untyped_edges: denominator.untypedEdgeCount + count((row) => row.owner !== "known", rows),
    unrepresented_charter_requirements: count((row) => row.charter !== "represented", rows) + count((requirement) => requirement.status !== "represented", denominator.charterRequirements),
    unresolved_wikidot_evidence_requirements: count((row) => row.evidence !== "resolved", rows),
  };
  exactKeys(counts, FINAL_ZERO_CLASSES, "final-zero counts");
  return counts;
}

export function parseArgs(argv) {
  const args = {};
  const names = new Set(["ledger", "inventory", "denominator", "deferred-denominator", "deferred-ledger", "standing-matrix", "repository", "output"]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return {help: true};
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    const value = argv[index + 1];
    if (!names.has(name) || Object.hasOwn(args, name) || !value || value.startsWith("--")) fail(`unknown or duplicate option: ${flag}`);
    args[name] = path.resolve(value);
  }
  for (const name of names) if (!args[name]) fail(`--${name} is required`);
  return args;
}

export function usage() {
  return "Usage: verify-final-zero.mjs --ledger FILE --inventory FILE --denominator FILE --deferred-denominator FILE --deferred-ledger FILE --standing-matrix FILE --repository DIR --output FILE";
}

export async function verifyFinalZero({ledger, inventory, denominator, deferredDenominator, deferredLedger, standingMatrix, repository}) {
  const denominatorValue = validateDenominator(JSON.parse(await fs.readFile(denominator, "utf8")));
  const canonical = await validateLedger(ledger, inventory, denominatorValue.rows);
  const deferredDenominatorRows = validateDeferredDenominator(JSON.parse(await fs.readFile(deferredDenominator, "utf8")));
  await validateDeferredLedger(deferredLedger, deferredDenominatorRows);
  const matrix = await validateStandingMatrix(standingMatrix, denominatorValue.ids, canonical, repository);
  const counts = finalZeroCounts(denominatorValue);
  const nonzero = Object.entries(counts).filter(([, value]) => value !== 0);
  if (nonzero.length > 0) fail(`final-zero check failed: ${nonzero.map(([name, value]) => `${name}=${value}`).join(", ")}`);
  return {
    schema: "wikijump.compatibility_final_zero_receipt.v1",
    status: "pass",
    merge_commit: matrix.merge_commit,
    counts,
    scope_admission: {
      status: "pass",
      current_deferred_rows: 0,
      deferred_rows: deferredDenominatorRows.length,
    },
    inputs: {
      ledger: {path: path.resolve(ledger), sha256: await sha256File(ledger)},
      inventory: {path: path.resolve(inventory), sha256: await sha256File(inventory)},
      denominator: {path: path.resolve(denominator), sha256: await sha256File(denominator)},
      deferred_denominator: {path: path.resolve(deferredDenominator), sha256: await sha256File(deferredDenominator)},
      deferred_ledger: {path: path.resolve(deferredLedger), sha256: await sha256File(deferredLedger)},
      standing_matrix: {path: path.resolve(standingMatrix), sha256: await sha256File(standingMatrix)},
    },
  };
}

export async function main(argv, {stdout = console.log} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout(usage());
    return 0;
  }
  const receipt = await verifyFinalZero({
    ledger: args.ledger,
    inventory: args.inventory,
    denominator: args.denominator,
    deferredDenominator: args["deferred-denominator"],
    deferredLedger: args["deferred-ledger"],
    standingMatrix: args["standing-matrix"],
    repository: args.repository,
  });
  const sealed = await sealJsonNoReplace(args.output, receipt);
  stdout(JSON.stringify({schema: receipt.schema, status: receipt.status, output: sealed.path, sha256: sealed.sha256}));
  return 0;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error?.stack ?? error?.message ?? String(error));
    return 1;
  },
});
