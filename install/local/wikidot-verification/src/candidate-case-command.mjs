import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { runCandidateCaseSet } from "./candidate-case-runner.mjs";
import {
  OPEN43_SETTINGS_ANALYTICS_CASE_IDS,
  OPEN43_SETTINGS_BROWSER_CASE_IDS,
  OPEN43_SETTINGS_THEME_CASE_IDS,
  OPEN43_SETTINGS_TOOLBAR_CASE_IDS,
} from "./open43-settings-browser-candidate-contract.mjs";
import { OPEN43_SETTINGS_LIFECYCLE_CASE_IDS } from "./open43-settings-lifecycle-candidate-contract.mjs";
import {
  canonicalJson,
  readJsonObject,
  requirePlainObject,
  sha256File,
} from "./standing-browser-parity-util.mjs";

const OPTIONS = ["case-set", "candidate-identity", "private-input", "output-dir", "run-id"];
const RUN_ID = /^candidate-run-[0-9a-f]{12}$/u;

export function candidateCaseUsage() {
  return `Usage: run-candidate-cases.mjs --case-set ${CANDIDATE_CASE_SET_NAMES.join("|")} --candidate-identity FILE --private-input PRIVATE.json --output-dir DIRECTORY --run-id candidate-run-<12 hex>

Runs under the propagated candidate lease. PRIVATE.json must be a private regular file with no group or other permissions. Receipts retain only its SHA-256 and secret hashes.`;
}

export function parseCandidateCaseArgs(argv) {
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  if (values.includes("--help") || values.includes("-h")) return { help: true };
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    if (!OPTIONS.includes(name) || Object.hasOwn(args, name) || !value || value.startsWith("--")) throw new Error(`unknown or duplicate option: ${flag}\n${candidateCaseUsage()}`);
    args[name] = value;
  }
  for (const name of OPTIONS) if (!args[name]) throw new Error(`missing --${name}\n${candidateCaseUsage()}`);
  if (!RUN_ID.test(args["run-id"])) throw new Error(`invalid --run-id\n${candidateCaseUsage()}`);
  return args;
}

export async function readPrivateCandidateCaseInput(filePath) {
  const before = await fs.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (before.mode & 0o077) !== 0) throw new Error("private input must be a private regular file with no group or other permissions");
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== before.dev || opened.ino !== before.ino || (opened.mode & 0o077) !== 0) throw new Error("private input changed while it was being opened");
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }
  let value;
  try {
    value = requirePlainObject(JSON.parse(bytes), "private candidate case input");
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("private candidate case input is not valid JSON");
    throw error;
  }
  return { value, sha256: createHash("sha256").update(bytes).digest("hex") };
}

const entry = (caseIds, load, aliasOf) => Object.freeze({
  caseIds: Object.freeze(caseIds),
  load,
  ...(aliasOf === undefined ? {} : { aliasOf: Object.freeze(aliasOf) }),
});

export const CANDIDATE_CASE_SETS = Object.freeze({
  "ftml-marker-contract": entry(["F1380_FTML_MARKER_CONTRACT"], () => import("./ftml-marker-contract-candidate-case-set.mjs").then(({ createFtmlMarkerContractCandidateCaseSet }) => createFtmlMarkerContractCandidateCaseSet())),
  "issue1373-amc-new-page": entry(["M1373_AMC_NEW_PAGE_AUTOSAVE"], () => import("./issue1373-amc-new-page-candidate-case-set.mjs").then(({ createIssue1373AmcNewPageCandidateCaseSet }) => createIssue1373AmcNewPageCandidateCaseSet())),
  "framerail-route-action-browser": entry(["DENIAL_DENIAL_CONTROL_CREATE", "DENIAL_DENIAL_CONTROL_RESTORE", "DENIAL_DENIAL_PANE_APPEND", "DENIAL_DENIAL_PANE_BACKLINKS", "DENIAL_DENIAL_PANE_DELETE", "DENIAL_DENIAL_PANE_EDIT_META", "DENIAL_DENIAL_PANE_LAYOUT", "DENIAL_DENIAL_PANE_LOCK", "DENIAL_DENIAL_PANE_MOVE", "DENIAL_DENIAL_PANE_PARENT", "DENIAL_DENIAL_PANE_SITE_TOOLS", "DENIAL_DENIAL_PANE_TAGS", "DENIAL_DENIAL_PANE_VOTE", "DENIAL_DENIAL_PANE_WATCHERS", "FAILURE_FAILURE_CONTROL_CREATE", "FAILURE_FAILURE_CONTROL_RESTORE", "FAILURE_FAILURE_PANE_APPEND", "FAILURE_FAILURE_PANE_BACKLINKS", "FAILURE_FAILURE_PANE_DELETE", "FAILURE_FAILURE_PANE_EDIT_META", "FAILURE_FAILURE_PANE_LAYOUT", "FAILURE_FAILURE_PANE_LOCK", "FAILURE_FAILURE_PANE_MOVE", "FAILURE_FAILURE_PANE_PARENT", "FAILURE_FAILURE_PANE_SITE_TOOLS", "FAILURE_FAILURE_PANE_TAGS", "FAILURE_FAILURE_PANE_VOTE", "FAILURE_FAILURE_PANE_WATCHERS", "SUCCESS_SELECTION_CONTROL_CREATE", "SUCCESS_LOADING_CONTROL_CREATE", "SUCCESS_SETTLED_CONTROL_CREATE", "SUCCESS_SUCCESS_CONTROL_CREATE", "SUCCESS_SELECTION_CONTROL_RESTORE", "SUCCESS_LOADING_CONTROL_RESTORE", "SUCCESS_SETTLED_CONTROL_RESTORE", "SUCCESS_SUCCESS_CONTROL_RESTORE", "SUCCESS_SELECTION_PANE_APPEND", "SUCCESS_LOADING_PANE_APPEND", "SUCCESS_SETTLED_PANE_APPEND", "SUCCESS_SUCCESS_PANE_APPEND", "SUCCESS_SELECTION_PANE_BACKLINKS", "SUCCESS_LOADING_PANE_BACKLINKS", "SUCCESS_SETTLED_PANE_BACKLINKS", "SUCCESS_SUCCESS_PANE_BACKLINKS", "SUCCESS_SELECTION_PANE_DELETE", "SUCCESS_LOADING_PANE_DELETE", "SUCCESS_SETTLED_PANE_DELETE", "SUCCESS_SUCCESS_PANE_DELETE", "SUCCESS_SELECTION_PANE_EDIT_META", "SUCCESS_LOADING_PANE_EDIT_META", "SUCCESS_SETTLED_PANE_EDIT_META", "SUCCESS_SUCCESS_PANE_EDIT_META", "SUCCESS_SELECTION_PANE_LAYOUT", "SUCCESS_LOADING_PANE_LAYOUT", "SUCCESS_SETTLED_PANE_LAYOUT", "SUCCESS_SUCCESS_PANE_LAYOUT", "SUCCESS_SELECTION_PANE_LOCK", "SUCCESS_LOADING_PANE_LOCK", "SUCCESS_SETTLED_PANE_LOCK", "SUCCESS_SUCCESS_PANE_LOCK", "SUCCESS_SELECTION_PANE_MOVE", "SUCCESS_LOADING_PANE_MOVE", "SUCCESS_SETTLED_PANE_MOVE", "SUCCESS_SUCCESS_PANE_MOVE", "SUCCESS_SELECTION_PANE_PARENT", "SUCCESS_LOADING_PANE_PARENT", "SUCCESS_SETTLED_PANE_PARENT", "SUCCESS_SUCCESS_PANE_PARENT", "SUCCESS_SELECTION_PANE_SITE_TOOLS", "SUCCESS_LOADING_PANE_SITE_TOOLS", "SUCCESS_SETTLED_PANE_SITE_TOOLS", "SUCCESS_SUCCESS_PANE_SITE_TOOLS", "SUCCESS_SELECTION_PANE_TAGS", "SUCCESS_LOADING_PANE_TAGS", "SUCCESS_SETTLED_PANE_TAGS", "SUCCESS_SUCCESS_PANE_TAGS", "SUCCESS_SELECTION_PANE_VOTE", "SUCCESS_LOADING_PANE_VOTE", "SUCCESS_SETTLED_PANE_VOTE", "SUCCESS_SUCCESS_PANE_VOTE", "SUCCESS_SELECTION_PANE_WATCHERS", "SUCCESS_LOADING_PANE_WATCHERS", "SUCCESS_SETTLED_PANE_WATCHERS", "SUCCESS_SUCCESS_PANE_WATCHERS"], () => import("./framerail-route-action-candidate-case-set.mjs").then(({ createFramerailRouteActionCandidateCaseSet }) => createFramerailRouteActionCandidateCaseSet())),
  "comments-hideform-browser": entry(["M1367_COMMENTS_HIDEFORM_ACTOR_FORM_STATE"], () => import("./comments-hideform-browser-candidate-case-set.mjs").then(({ createCommentsHideformBrowserCandidateCaseSet }) => createCommentsHideformBrowserCandidateCaseSet())),
  "open43-actions": entry(["A1041_CENTRAL_REGISTRY_AND_MUTATION", "A1041_SET_TAGS_CONTENTION"], () => import("./open43-actions-candidate-case-set.mjs").then(({ createOpen43ActionsCandidateCaseSet }) => createOpen43ActionsCandidateCaseSet())),
  "open43-membership": entry(["A1060_ORDINARY_MEMBER_PAGE_CREATE", "A1033_CENTRAL_STATIC_MODULE_MATRIX"], () => import("./open43-membership-candidate-case-set.mjs").then(({ createOpen43MembershipCandidateCaseSet }) => createOpen43MembershipCandidateCaseSet())),
  "open43-membership-join": entry(["A1029_CENTRAL_PUBLIC_SEAMS", "A1029_TWO_TRANSACTION_CONTENTION"], () => import("./open43-membership-join-candidate-case-set.mjs").then(({ createOpen43MembershipJoinCandidateCaseSet }) => createOpen43MembershipJoinCandidateCaseSet())),
  "open43-issue1060-register-join-create": entry(["A1060_BROWSER_REGISTER_JOIN_CREATE", "A1060_CONCURRENT_SELF_JOIN_AND_CREATE", "A1060_FRESH_SEED_CARGO_MATRIX"], () => import("./open43-issue1060-register-join-create-candidate-case-set.mjs").then(({ createOpen43Issue1060RegisterJoinCreateCandidateCaseSet }) => createOpen43Issue1060RegisterJoinCreateCandidateCaseSet())),
  "open43-backlinks": entry(["Q1027_BACKLINKS_PREVIEW_SAVED_FAIL_CLOSED"], () => import("./open43-backlinks-candidate-case-set.mjs").then(({ createOpen43BacklinksCandidateCaseSet }) => createOpen43BacklinksCandidateCaseSet())),
  "open43-authoring": entry(["A1061_EXACT_PUBLIC_SLICE_CANDIDATE", "A1061_EXACT_POST_COMMIT_WORKER_CANDIDATE", "A1061_FIRST_RELOAD_INTERVALS"], () => import("./open43-authoring-candidate-case-set.mjs").then(({ createOpen43AuthoringCandidateCaseSet }) => createOpen43AuthoringCandidateCaseSet())),
  "open43-categories": entry(["Q1028_CATEGORY_LIFECYCLE_AND_CACHE"], () => import("./open43-categories-candidate-case-set.mjs").then(({ createOpen43CategoriesCandidateCaseSet }) => createOpen43CategoriesCandidateCaseSet())),
  "open43-media-files": entry(["M1039_MUTATION_TO_NEXT_READ", "M1043_RESIZED_BLOB_IDENTITY", "M1062_SERIALIZABLE_ACTION_RESPONSE", "M1062_UPLOAD_TRANSACTION_ORDER"], () => import("./open43-media-candidate-case-set.mjs").then(({ createOpen43MediaCandidateCaseSet }) => createOpen43MediaCandidateCaseSet())),
  "open43-media-browser": entry(["M756_BROWSER_CACHE_TRANSITIONS", "M776_BROWSER_GEOMETRY_AND_NETWORK", "M806_BROWSER_GEOMETRY_AND_NETWORK", "M1043_BROWSER_RENDER_AND_VIEWER", "M1062_BROWSER_UPLOAD_FLOW"], () => import("./open43-media-browser-candidate.mjs").then(({ createOpen43MediaBrowserCandidateCaseSet }) => createOpen43MediaBrowserCandidateCaseSet())),
  "open43-embedvideo-browser": entry(["M1042_BROWSER_LIFECYCLE"], () => import("./open43-embedvideo-browser-candidate.mjs").then(({ createOpen43EmbedVideoBrowserCandidateCaseSet }) => createOpen43EmbedVideoBrowserCandidateCaseSet())),
  "open43-authoring-history": entry(["A1063_EXACT_PUBLIC_SOURCE_CANDIDATE", "A1063_DIFF_BROWSER_WORKFLOW", "A1063_SETTINGS_BROWSER_WORKFLOW"], () => import("./open43-authoring-history-candidate-case-set.mjs").then(({ createOpen43AuthoringHistoryCandidateCaseSet }) => createOpen43AuthoringHistoryCandidateCaseSet())),
  "open43-page-tree": entry(["Q779_EXPLICIT_ROOT_ACTOR_AND_LIFECYCLE_CANDIDATE"], () => import("./open43-page-tree-candidate-case-set.mjs").then(({ createOpen43PageTreeCandidateCaseSet }) => createOpen43PageTreeCandidateCaseSet())),
  "open43-page-query-nextprevious": entry(["Q811_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE"], () => import("./open43-nextprevious-candidate-case-set.mjs").then(({ createOpen43NextPreviousCandidateCaseSet }) => createOpen43NextPreviousCandidateCaseSet())),
  "open43-settings-browser": entry(OPEN43_SETTINGS_BROWSER_CASE_IDS, () => import("./open43-settings-browser-candidate-case-set.mjs").then(({ createOpen43SettingsBrowserCandidateCaseSet }) => createOpen43SettingsBrowserCandidateCaseSet()), ["open43-settings-analytics", "open43-settings-theme", "open43-settings-toolbar", "open43-settings-admin"]),
  "open43-settings-analytics": entry(OPEN43_SETTINGS_ANALYTICS_CASE_IDS, () => import("./open43-settings-browser-candidate-case-set.mjs").then(({ createOpen43SettingsGroupCandidateCaseSet }) => createOpen43SettingsGroupCandidateCaseSet({"group": "analytics"}))),
  "open43-settings-theme": entry(OPEN43_SETTINGS_THEME_CASE_IDS, () => import("./open43-settings-browser-candidate-case-set.mjs").then(({ createOpen43SettingsGroupCandidateCaseSet }) => createOpen43SettingsGroupCandidateCaseSet({"group": "theme"}))),
  "open43-settings-toolbar": entry(OPEN43_SETTINGS_TOOLBAR_CASE_IDS, () => import("./open43-settings-browser-candidate-case-set.mjs").then(({ createOpen43SettingsGroupCandidateCaseSet }) => createOpen43SettingsGroupCandidateCaseSet({"group": "toolbar"}))),
  "open43-settings-admin": entry(["S1046_ADMIN_INITIAL", "S1046_ADMIN_SETTLED", "S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX"], () => import("./open43-settings-browser-candidate-case-set.mjs").then(({ createOpen43SettingsGroupCandidateCaseSet }) => createOpen43SettingsGroupCandidateCaseSet({"group": "admin"}))),
  "open43-settings-lifecycle": entry(OPEN43_SETTINGS_LIFECYCLE_CASE_IDS, () => import("./open43-settings-lifecycle-candidate-case-set.mjs").then(({ createOpen43SettingsLifecycleCandidateCaseSet }) => createOpen43SettingsLifecycleCandidateCaseSet())),
  "open43-settings-page-tags": entry(["B822_PAGE_TAGS_INITIAL", "B822_PAGE_TAGS_SETTLED"], () => import("./open43-page-tags-browser-candidate-case-set.mjs").then(({ createOpen43PageTagsBrowserCandidateCaseSet }) => createOpen43PageTagsBrowserCandidateCaseSet())),
  "open43-mailform-fail-closed": entry(["A1037_MAILFORM_FAIL_CLOSED_SERVED"], () => import("./open43-mailform-candidate-case-set.mjs").then(({ createOpen43MailformCandidateCaseSet }) => createOpen43MailformCandidateCaseSet())),
  "open43-simpletodo-read-only": entry(["A1037_SIMPLETODO_READ_ONLY_SERVED"], () => import("./open43-simpletodo-candidate-case-set.mjs").then(({ createOpen43SimpletodoCandidateCaseSet }) => createOpen43SimpletodoCandidateCaseSet())),
  "open43-b610-shell": entry(["B610_SHELL_PUBLIC_CONTRACT"], () => import("./open43-b610-shell-candidate-case-set.mjs").then(({ createOpen43B610ShellCandidateCaseSet }) => createOpen43B610ShellCandidateCaseSet())),
  "open43-issue775-edit": entry(["A775_ACTOR_NAVIGATION_BROWSER"], () => import("./open43-issue775-edit-candidate-case-set.mjs").then(({ createOpen43Issue775EditCandidateCaseSet }) => createOpen43Issue775EditCandidateCaseSet())),
  "open43-issue777-print": entry(["A777_BROWSER_PRINT_LIFECYCLE"], () => import("./open43-issue777-print-candidate-case-set.mjs").then(({ createOpen43Issue777PrintCandidateCaseSet }) => createOpen43Issue777PrintCandidateCaseSet())),
  "open43-issue1029-join": entry(["A1029_EXACT_BROWSER_TRANSITIONS"], () => import("./open43-issue1029-join-candidate-case-set.mjs").then(({ createOpen43Issue1029JoinCandidateCaseSet }) => createOpen43Issue1029JoinCandidateCaseSet())),
  "open43-issue1041-action-lifecycle": entry(["A1041_EXACT_BROWSER_LIFECYCLE"], () => import("./open43-issue1041-lifecycle-candidate-case-set.mjs").then(({ createOpen43Issue1041LifecycleCandidateCaseSet }) => createOpen43Issue1041LifecycleCandidateCaseSet())),
  "open43-searchall": entry(["Q807_EXACT_CANDIDATE_FORM_ROUTE_BROWSER"], () => import("./open43-q807-searchall-candidate-case-set.mjs").then(({ createOpen43Q807SearchAllCandidateCaseSet }) => createOpen43Q807SearchAllCandidateCaseSet())),
  "open43-q748-topbar-search": entry(["Q748_LIVE_TOPBAR_SUBMISSION_CONTRACT", "Q748_EXACT_CANDIDATE_BROWSER_SUBMISSION"], () => import("./open43-q748-topbar-search-candidate-case-set.mjs").then(({ createOpen43Q748TopBarSearchCandidateCaseSet }) => createOpen43Q748TopBarSearchCandidateCaseSet())),
  "open43-a1038-admin-boundary": entry(["A1038_AUTHENTICATED_NON_ADMIN_DENIAL"], () => import("./open43-a1038-admin-boundary-candidate-case-set.mjs").then(({ createOpen43A1038AdminBoundaryCandidateCaseSet }) => createOpen43A1038AdminBoundaryCandidateCaseSet())),
  "open43-a1030-rate": entry(["A1030_CENTRAL_RUST_MATRIX", "A1030_TWO_TRANSACTION_CONTENTION", "A1030_EXACT_CANDIDATE_BROWSER"], () => import("./open43-a1030-rate-candidate-case-set.mjs").then(({ createOpen43A1030RateCandidateCaseSet }) => createOpen43A1030RateCandidateCaseSet())),
  "open43-q778-forum-mini": entry(["Q778_EXACT_CANDIDATE_24_CASE_REPLAY", "Q778_EXACT_CANDIDATE_SAVED_PAGE_RUNTIME", "Q778_BROWSER_ROUTE_IDENTITY_AND_SETTLING"], () => import("./open43-q778-forum-mini-candidate-case-set.mjs").then(({ createOpen43Q778ForumMiniCandidateCaseSet }) => createOpen43Q778ForumMiniCandidateCaseSet())),
  "open43-q1034-forum": entry(["Q1034_EXACT_CANDIDATE_PUBLIC_READ_MODELS", "Q1034_EXACT_CANDIDATE_FORUM_ROUTES_AND_AJAX", "Q1034_EXACT_CANDIDATE_RECENTTHREADS"], () => import("./open43-q1034-forum-candidate-case-set.mjs").then(({ createOpen43Q1034ForumCandidateCaseSet }) => createOpen43Q1034ForumCandidateCaseSet())),
  "open43-q1035-sitechanges": entry(["Q1035_SITECHANGES_DEFAULT_INITIAL_SNAPSHOT", "Q1035_SITECHANGES_PERMISSION_BEFORE_LIMIT", "Q1035_SITECHANGES_FILTER_AND_AJAX_PAGER", "Q1035_LISTDRAFTS_EMPTY_STATE_MATRIX"], () => import("./open43-q1035-sitechanges-candidate-case-set.mjs").then(({ createOpen43Q1035SiteChangesCandidateCaseSet }) => createOpen43Q1035SiteChangesCandidateCaseSet())),
  "open43-q809": entry(["Q809_PERMISSION_BEFORE_LIMIT_CANDIDATE", "Q809_SERVED_MUTATION_AND_BROWSER_CANDIDATE"], () => import("./open43-q809-candidate-case-set.mjs").then(({ createOpen43Q809CandidateCaseSet }) => createOpen43Q809CandidateCaseSet())),
  "open43-q1026-user-identity": entry(["Q1026_EXACT_CANDIDATE_PREVIEW_SAVED_IDENTITY", "Q1026_BROWSER_PRINTUSER_INTERVALS"], () => import("./open43-q1026-user-identity-candidate-case-set.mjs").then(({ createOpen43Q1026UserIdentityCandidateCaseSet }) => createOpen43Q1026UserIdentityCandidateCaseSet())),
  "open43-q1027": entry(["Q1027_RENAME_DELETE_RESTORE_CACHE_AND_SERVED_CANDIDATE"], () => import("./open43-q1027-candidate-case-set.mjs").then(({ createOpen43Q1027CandidateCaseSet }) => createOpen43Q1027CandidateCaseSet())),
  "open43-q1032-members-userinfo": entry(["Q1032_EXACT_CANDIDATE_DIRECTORY_MATRIX", "Q1032_MEMBERS_AJAX_EXACT_CANDIDATE", "Q1032_BROWSER_DIRECTORY_ACTIONS"], () => import("./open43-q1032-members-userinfo-candidate-case-set.mjs").then(({ createOpen43Q1032CandidateCaseSet }) => createOpen43Q1032CandidateCaseSet())),
  "open43-q1036-search-feed": entry(["Q1036_EXACT_CANDIDATE_PREVIEW_SAVED_BOUNDARIES"], () => import("./open43-q1036-search-feed-candidate-case-set.mjs").then(({ createOpen43Q1036CandidateCaseSet }) => createOpen43Q1036CandidateCaseSet())),
  "open43-q1040": entry(["Q1040_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE"], () => import("./open43-q1040-candidate-case-set.mjs").then(({ createOpen43Q1040CandidateCaseSet }) => createOpen43Q1040CandidateCaseSet())),
  "open43-featuredsite": entry(["Q810_CANDIDATE_FAIL_CLOSED_NETWORK"], () => import("./open43-q810-featuredsite-candidate-case-set.mjs").then(({ createOpen43FeaturedSiteCandidateCaseSet }) => createOpen43FeaturedSiteCandidateCaseSet())),
  "open43-689-tabview": entry(["B689_TABVIEW_INITIAL"], () => import("./open43-browser-689-candidate-case-set.mjs").then(({ createOpen43B689TabviewCandidateCaseSet }) => createOpen43B689TabviewCandidateCaseSet())),
  "open43-690-geometry": entry(["B690_GEOMETRY_INITIAL", "B690_GEOMETRY_SETTLED", "B690_FIXED_SIX_PAGE_DENOMINATOR"], () => import("./open43-browser-690-candidate-case-set.mjs").then(({ createOpen43B690GeometryCandidateCaseSet }) => createOpen43B690GeometryCandidateCaseSet())),
});

export const CANDIDATE_CASE_SET_NAMES = Object.freeze(Object.keys(CANDIDATE_CASE_SETS));

export async function candidateCaseSet(name) {
  const registered = CANDIDATE_CASE_SETS[name];
  if (!registered) throw new Error(`unknown source-owned candidate case set: ${name}`);
  return registered.load();
}

function interruption() {
  const controller = new AbortController();
  const handlers = ["SIGINT", "SIGTERM"].map((name) => {
    const handler = () => controller.abort(new Error(`candidate case run interrupted by ${name}`));
    process.once(name, handler);
    return [name, handler];
  });
  return { signal: controller.signal, close: () => handlers.forEach(([name, handler]) => process.off(name, handler)) };
}

export async function runCandidateCaseCommand(args) {
  const [identity, identitySha256, privateInput, selectedCaseSet] = await Promise.all([
    readJsonObject(args["candidate-identity"], "candidate identity"),
    sha256File(args["candidate-identity"]),
    readPrivateCandidateCaseInput(args["private-input"]),
    candidateCaseSet(args["case-set"]),
  ]);
  const outputDir = path.resolve(args["output-dir"]);
  await fs.mkdir(path.dirname(outputDir), { recursive: true, mode: 0o700 });
  const globalLockPath = path.join(os.tmpdir(), "wikijump-candidate-run.lock");
  let globalLock;
  try {
    globalLock = JSON.parse(await fs.readFile(globalLockPath, "utf8"));
  } catch (error) {
    throw new Error(`candidate global lease is unavailable: ${error.message}`);
  }
  if (globalLock?.schema !== "wikijump.candidate_global_lock.v1" || globalLock.run_id !== args["run-id"]) throw new Error("candidate global lease does not bind the propagated run ID");
  const signals = interruption();
  try {
    return await runCandidateCaseSet({
      candidateIdentity: identity,
      candidateIdentitySha256: identitySha256,
      privateInput: privateInput.value,
      privateInputSha256: privateInput.sha256,
      outputDir,
      caseSet: selectedCaseSet,
      runId: args["run-id"],
      signal: signals.signal,
    });
  } finally {
    signals.close();
  }
}

export async function candidateCaseMain(argv = process.argv.slice(2)) {
  const args = parseCandidateCaseArgs(argv);
  if (args.help) return void process.stdout.write(`${candidateCaseUsage()}\n`);
  process.stdout.write(canonicalJson(await runCandidateCaseCommand(args)));
}
