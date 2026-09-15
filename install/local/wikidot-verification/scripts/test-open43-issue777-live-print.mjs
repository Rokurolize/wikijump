#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EXPECTED_URL = "https://www.wikidot.com/doc-wiki-syntax:buttons";
const EXPECTED_OPERATIONS = [
  "click",
  "enter",
  "space",
  "rapid_repeated_click",
  "sequential_repeated_click",
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parseArgs(argv) {
  const index = argv.indexOf("--artifact-dir");
  if (index < 0 || !argv[index + 1]) fail("--artifact-dir is required");
  return path.resolve(argv[index + 1]);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function assertHashManifest(directory) {
  const manifestPath = path.join(directory, "SHA256SUMS");
  assert(fs.existsSync(manifestPath), "SHA256SUMS is missing");
  const listed = new Set();
  for (const line of fs.readFileSync(manifestPath, "utf8").trim().split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})  ([^/\\]+)$/.exec(line);
    assert(match !== null, `invalid SHA256SUMS line: ${line}`);
    const [, expected, name] = match;
    assert(!listed.has(name), `duplicate hash entry: ${name}`);
    listed.add(name);
    const file = path.join(directory, name);
    assert(fs.existsSync(file) && fs.statSync(file).isFile(), `hashed file is missing: ${name}`);
    assert(sha256File(file) === expected, `hash mismatch: ${name}`);
  }
  const actual = fs.readdirSync(directory, {withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS")
    .map((entry) => entry.name)
    .sort();
  assert(sameJson([...listed].sort(), actual), "SHA256SUMS does not cover exactly the retained files");
}

function assertSnapshot(snapshot, label, expectedFocused) {
  assert(snapshot && typeof snapshot === "object", `${label} snapshot missing`);
  assert(snapshot.url === EXPECTED_URL, `${label} URL changed`);
  assert(snapshot.pathname === "/doc-wiki-syntax:buttons", `${label} pathname changed`);
  assert(snapshot.ready_state === "complete", `${label} document is not complete`);
  assert(snapshot.print_control?.count === 1, `${label} print control count changed`);
  assert(snapshot.print_control.rendered === true, `${label} print control is not rendered`);
  assert(snapshot.print_control.focused === expectedFocused, `${label} focus state drifted`);
  assert(snapshot.print_control.aria_busy === null, `${label} live control acquired an aria-busy state`);
  assert(snapshot.print_control.element?.attrs?.href === "javascript:;", `${label} href drifted`);
  assert(snapshot.print_control.element?.attrs?.onclick?.includes("WIKIDOT.page.listeners.printClick(event)"), `${label} onclick drifted`);
  assert(snapshot.print_control.element?.attrs?.class === "wiki-standalone-button", `${label} class drifted`);
  assert(snapshot.media_print_matches === false, `${label} matchMedia(print) unexpectedly remained active`);
  assert(Number.isSafeInteger(snapshot.history_length) && snapshot.history_length >= 1, `${label} history length missing`);
}

function assertPopup(popup) {
  assert(popup && typeof popup === "object", "popup observation is missing");
  assert(popup.identity?.href === "https://www.wikidot.com/printer--friendly//doc-wiki-syntax:buttons", "printer-friendly popup URL drifted");
  assert(popup.identity?.print_control_count === 1, "printer-friendly popup print-control count drifted");
  assert(popup.identity?.print_handler === "window.print()", "printer-friendly native print handler drifted");
  const snapshots = popup.snapshots;
  for (const [label, snapshot] of Object.entries(snapshots ?? {})) {
    assert(snapshot.url === popup.identity.href, `popup ${label} URL changed`);
    assert(snapshot.print_control?.count === 1 && snapshot.print_control.rendered === true, `popup ${label} control drifted`);
    assert(snapshot.print_control.aria_busy === null, `popup ${label} acquired aria-busy`);
    assert(snapshot.print_control.element?.attrs?.href === "javascript:;", `popup ${label} href drifted`);
    assert(snapshot.print_control.element?.attrs?.onclick === "window.print()", `popup ${label} onclick drifted`);
    assert(snapshot.media_print_matches === false, `popup ${label} matchMedia(print) unexpectedly remained active`);
  }
  assert(snapshots.baseline.print_control.focused === false, "popup baseline unexpectedly focused the native print control");
  assert(snapshots.before.print_control.focused === true, "popup native print control did not receive focus before activation");
  assert(snapshots.immediate.print_control.focused === true && snapshots.after_500ms.print_control.focused === true, "popup native print control lost focus after activation");
  assert(new Set(Object.values(snapshots).map((snapshot) => snapshot.history_length)).size === 1, "popup history.length changed during native print activation");
  assert(popup.history_entries_unchanged === true && popup.url_unchanged === true, "popup navigation state changed during native print activation");
  assert(Array.isArray(popup.print_calls) && popup.print_calls.length === 1, "popup native print call count drifted");
  const call = popup.print_calls[0];
  assert(call.url === popup.identity.href && call.focused_control === true && call.argument_count === 0, "popup native print call identity drifted");
  assert(call.return_type === "undefined", "popup native print return type drifted");
  const timeline = popup.action_timeline?.timeline ?? [];
  assert(timeline.some((event) => event.kind === "window.print.before" && event.ordinal === 1), "popup window.print before event is missing");
  assert(timeline.some((event) => event.kind === "window.event" && event.event_type === "beforeprint"), "popup beforeprint event is missing");
  assert(!timeline.some((event) => event.kind === "window.event" && event.event_type === "afterprint"), "popup afterprint event was outside the recorded headless observation window");
  assert(popup.screenshot?.bytes > 0, "popup final screenshot is empty");
}

function assertOperation(operation, expectedBeforeFocused, expectedPopupCount) {
  assert(operation && typeof operation === "object", `${operation?.name ?? "operation"} is missing`);
  const snapshots = operation.snapshots;
  for (const [label, snapshot] of Object.entries(snapshots ?? {})) {
    assertSnapshot(snapshot, `${operation.name}.${label}`, label === "initial" ? false : label === "before_activation" ? expectedBeforeFocused : true);
  }
  const ordered = [snapshots.initial, snapshots.before_activation, snapshots.immediate_after_input, snapshots.after_100ms, snapshots.after_500ms, snapshots.after_1000ms];
  const historyLengths = ordered.map((snapshot) => snapshot.history_length);
  assert(new Set(historyLengths).size === 1, `${operation.name} history.length changed during activation`);
  assert(operation.url_unchanged === true, `${operation.name} URL/navigation changed`);
  assert(operation.history_entries_unchanged === true, `${operation.name} CDP navigation history changed`);
  assert((operation.cdp_navigation_events ?? []).length === 0, `${operation.name} emitted a navigation event`);
  assert(operation.network?.non_safe_request_count >= 0, `${operation.name} network observation is missing`);
  assert(Array.isArray(operation.print_calls) && operation.print_calls.length === 0, `${operation.name} unexpectedly called window.print in the opener`);
  assert(operation.action_timeline?.printCalls?.length === 0, `${operation.name} opener print-call timeline is not empty`);
  assert(Array.isArray(operation.open_calls) && operation.open_calls.length === expectedPopupCount, `${operation.name} popup-open count drifted`);
  for (const call of operation.open_calls) {
    assert(call.requested_url === "/printer--friendly//doc-wiki-syntax:buttons", `${operation.name} popup URL request drifted`);
    assert(call.target_name === "_blank" && call.returned_window === true, `${operation.name} popup window-open result drifted`);
  }
  assert(operation.popup_target_count === expectedPopupCount, `${operation.name} popup target count drifted`);
  assert((operation.popup_observations ?? []).length === expectedPopupCount, `${operation.name} popup observations are incomplete`);
  for (const popup of operation.popup_observations) assertPopup(popup);
  assert((operation.popup_cleanup?.remaining_target_ids ?? []).length === 0, `${operation.name} popup cleanup left targets behind`);
  assert(snapshots.initial.print_control.element.outer_html === snapshots.after_1000ms.print_control.element.outer_html, `${operation.name} print control DOM changed`);
  assert(snapshots.initial.adjacent_dom.parent_outer_html === snapshots.after_1000ms.adjacent_dom.parent_outer_html, `${operation.name} adjacent DOM changed`);
  assert(snapshots.after_1000ms.mutation_count === snapshots.initial.mutation_count, `${operation.name} related DOM mutation count changed`);
  assert(operation.final_screenshot?.bytes > 0, `${operation.name} final screenshot is empty`);
}

function main() {
  const directory = parseArgs(process.argv.slice(2));
  const capturePath = path.join(directory, "capture.json");
  const cleanupPath = path.join(directory, "cleanup.json");
  assert(fs.existsSync(capturePath), "capture.json is missing");
  assert(fs.existsSync(cleanupPath), "cleanup.json is missing");
  const capture = readJson(capturePath);
  const cleanup = readJson(cleanupPath);
  assert(capture.schema === "wikidot.open43_issue777_exact_live_print_transitions.v1", "capture schema drifted");
  assert(capture.issue === 777 && capture.case_id === "A777_EXACT_LIVE_PRINT_TRANSITIONS", "issue/case identity drifted");
  assert(capture.result === "observed_live_public_read_only", "capture is not a public live observation");
  assert(capture.authority?.tier === "anonymous_read_only_live_behavior", "authority tier drifted");
  assert(capture.authority?.mutation_performed === false, "public page mutation was recorded");
  assert(capture.authority?.page_url_observed === EXPECTED_URL, "observed URL drifted");
  assert(capture.fixture?.count === 1, "fixture print-control count drifted");
  assert(capture.fixture?.baseline?.print_control?.focused === false, "baseline unexpectedly focused the print control");
  assert(capture.browser_identity?.user_agent?.includes("HeadlessChrome"), "capture is not bound to headless Chrome");
  assert(capture.browser_identity?.browser_get_version?.product?.startsWith("Chrome/"), "Chrome product identity is missing");
  assert(/^[0-9a-f]{64}$/.test(capture.browser_identity?.executable_sha256 ?? ""), "Chrome executable SHA-256 is missing");
  assert(capture.browser_identity?.viewport?.width === 1280 && capture.browser_identity?.viewport?.height === 900, "viewport identity drifted");
  assert(capture.native_print_observation?.headless_user_agent === true, "headless print limitation is missing");
  assert(capture.native_print_observation?.limitation?.includes("no native print-dialog surface"), "native-dialog limitation is not explicit");
  assert(capture.timeline_contract?.native_dialog_policy === "native print dialog was not automated, dismissed, or solved", "native-dialog policy drifted");
  assert(sameJson(Object.keys(capture.operations ?? {}), EXPECTED_OPERATIONS), "operation denominator drifted");
  assertOperation(capture.operations.click, false, 1);
  assertOperation(capture.operations.enter, true, 1);
  assertOperation(capture.operations.space, true, 0);
  assertOperation(capture.operations.rapid_repeated_click, true, 2);
  assertOperation(capture.operations.sequential_repeated_click, true, 2);
  assert(cleanup.schema === "wikidot.open43_issue777_profile_cleanup.v1", "cleanup schema drifted");
  assert(cleanup.status === "verified_removed", "task-owned profile cleanup was not verified");
  assert(cleanup.stop_exit_code === 0 && cleanup.remove_exit_code === 0, "profile cleanup command failed");
  assert(cleanup.profile_exists_after_commands === false, "task-owned profile remains");
  assert(cleanup.devtools_active_port_exists_after_commands === false, "DevToolsActivePort remains after cleanup");
  assert(cleanup.marker_exists_after_commands === false, "Codex profile marker remains after cleanup");
  assertHashManifest(directory);
  process.stdout.write(JSON.stringify({ok: true, artifact_dir: directory, operations: EXPECTED_OPERATIONS.length, retained_files: fs.readdirSync(directory).sort()}, null, 2) + "\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
