#!/usr/bin/env node

// Sequential, receipt-driven campaign runner. Each case uses the existing
// persistent Theme Lab daemon and an already acquired offline reference.
import fs from "node:fs";
import {assertPublishablePackage} from "../src/adaptation-authority.mjs";
import crypto from "node:crypto";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const ports = path.join(root, "install/local/theme-lab/ports");
const manifestPath = process.env.THEME_LAB_CAMPAIGN_MANIFEST ?? path.join(ports, "en-theme-campaign.json");
const socket = process.env.THEME_LAB_SOCKET ?? "/tmp/theme-lab-en34.sock";
const dearSocket = process.env.THEME_LAB_DEAR_SOCKET ?? socket;
const siteId = process.env.THEME_LAB_SITE_ID ?? "6000003";
const runArtifactRoot = process.env.THEME_LAB_RUN_ARTIFACT_DIR ? path.resolve(process.env.THEME_LAB_RUN_ARTIFACT_DIR) : null;
const sharedSelectors = path.join(ports, "shared-acceptance-selectors.txt");
const lab = path.join(root, "install/local/theme-lab/scripts/theme-lab.mjs");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const assetRoot = path.resolve(process.env.THEME_LAB_ASSET_DIR ?? path.join(ports, "shared-replay-assets"));
const assetByDigest = new Map();
for (const name of fs.readdirSync(assetRoot)) {
  const digest = name.match(/^([0-9a-f]{64})\./u)?.[1];
  if (digest && !assetByDigest.has(digest)) assetByDigest.set(digest, name);
}

// The daemon materializes candidate assets from its own --asset-dir, which is an
// unverified external input rather than the frozen pool this runner verifies. A
// daemon pool that predates the committed pool reports candidate_asset_missing
// for assets the package already declares, so the mismatch has to fail closed
// before it can be misread as a port-authoritative package finding.
const daemonAssetDirs = new Map();
function daemonAssetDir(socketPath) {
  if (daemonAssetDirs.has(socketPath)) return daemonAssetDirs.get(socketPath);
  const status = spawnSync(process.execPath, [lab, "status", "--socket", socketPath],
    {cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024});
  if (status.status !== 0) {
    const detail = (status.stderr || status.error?.message || "").trim().slice(0, 300);
    throw new Error(`Theme Lab daemon status unavailable on ${socketPath}: ${detail}`);
  }
  let response;
  try { response = JSON.parse(status.stdout); } catch {
    throw new Error(`Theme Lab daemon status returned invalid JSON on ${socketPath}`);
  }
  if (response.ok === false) throw new Error(`Theme Lab daemon status failed on ${socketPath}: ${response.error?.code ?? "unknown_error"}`);
  const dir = response.result?.asset_dir;
  if (!dir) throw new Error(`Theme Lab daemon on ${socketPath} has no --asset-dir; candidate asset findings would be unverifiable`);
  const resolved = fs.realpathSync(dir);
  daemonAssetDirs.set(socketPath, resolved);
  return resolved;
}
const shaCache = new Map();

function sha256(file) {
  let digest = shaCache.get(file);
  if (!digest) {
    digest = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    shaCache.set(file, digest);
  }
  return digest;
}

function verifyFrozenPackage(item, {requireDaemonAssets = true} = {}) {
  // dear-dictator and quand-le-soleil-se-couche keep their own packaged assets
  // and are served by dedicated daemons, so their frozen pool is the daemon's
  // asset dir by construction and there is no second pool to reconcile.
  if (item.slug === "theme:dear-dictator (SCP-KO)") return;
  if (path.basename(item.directory) === "quand-le-soleil-se-couche") {
    const foreign = JSON.parse(fs.readFileSync(path.join(item.directory,"manifest.json"),"utf8"));
    if (sha256(path.join(item.directory,"upstream-fr.wikidot.txt")) !== foreign.source_sha256) throw new Error("FR frozen source identity mismatch");
    for (const asset of foreign.assets) if (sha256(path.join(item.directory,"assets",asset.name)) !== asset.sha256) throw new Error(`FR frozen asset mismatch: ${asset.name}`);
    return;
  }
  const packageManifest = JSON.parse(fs.readFileSync(path.join(item.directory, "manifest.json"), "utf8"));
  const identity = packageManifest.source_identity;
  for (const [key, file] of [["en", "upstream-en.wikidot.txt"], ["jp", "existing-jp.wikidot.txt"]]) {
    const source = identity?.[key];
    if (!source?.sha256) continue;
    const sourcePath = path.join(item.directory, file);
    if (!fs.existsSync(sourcePath) || sha256(sourcePath) !== source.sha256) {
      throw new Error(`${item.slug}: frozen ${key.toUpperCase()} source identity mismatch`);
    }
  }
  const candidateSource = fs.readFileSync(path.join(item.directory, "candidate.wikidot.source.txt"), "utf8");
  const allowlistPath = path.join(item.directory, "confirmed-jp-user-links.json");
  const confirmedJpUsers = new Set(fs.existsSync(allowlistPath)
    ? JSON.parse(fs.readFileSync(allowlistPath, "utf8")).users.map((name) => name.toLowerCase()) : []);
  const unresolvedSiteLocalCredits = [...candidateSource.matchAll(/\[\[\*user\s+([^\]]+)\]\]/giu)]
    .map((match) => match[1].trim()).filter((name) => !confirmedJpUsers.has(name.toLowerCase()));
  if (unresolvedSiteLocalCredits.length) {
    throw new Error(`${item.slug}: ${unresolvedSiteLocalCredits.length} unreviewed site-local author identity link(s); confirm on SCP-JP or preserve the credited name as text`);
  }
  const assetManifest = JSON.parse(fs.readFileSync(path.join(item.directory, "assets.json"), "utf8"));
  // --verify-only stays hermetic and daemon-free, so the daemon pool is only
  // reconciled when this run will actually ask the daemon to render the CSS.
  const served = requireDaemonAssets ? daemonAssetDir(item.socket ?? socket) : null;
  for (const asset of assetManifest.assets ?? []) {
    const filename = assetByDigest.get(asset.sha256);
    if (!filename || sha256(path.join(assetRoot, filename)) !== asset.sha256) {
      throw new Error(`${item.slug}: frozen CSS asset missing or corrupt: ${asset.sha256}`);
    }
    const servedFile = served && path.join(served, filename);
    if (servedFile && (!fs.existsSync(servedFile) || sha256(servedFile) !== asset.sha256)) {
      throw new Error(
        `${item.slug}: Theme Lab daemon asset pool ${served} does not contain the frozen CSS asset ${filename}. `
        + `The package declares it, so a candidate_asset_missing finding here would be a daemon asset-pool `
        + `artifact and not a port finding. Restart the daemon with --asset-dir ${assetRoot}.`);
    }
  }
  const imports = new Set(assetManifest.imports ?? []);
  const importProvenance = assetManifest.import_provenance ?? [];
  const provenImports = new Set(importProvenance.map((row) => row.source_url));
  if (assetManifest.import_provenance_status === "complete") {
    for (const url of imports) {
      if (!provenImports.has(url)) throw new Error(`${item.slug}: frozen CSS import lacks byte provenance: ${url}`);
    }
  }
  for (const row of importProvenance) {
    const file = path.join(assetRoot, row.asset_file);
    if (!row.asset_file || !fs.existsSync(file) || sha256(file) !== row.sha256) {
      throw new Error(`${item.slug}: frozen CSS import missing or corrupt: ${row.source_url}`);
    }
  }
  if (packageManifest.flattened_css_transforms) {
    const transformPath = path.join(item.directory, packageManifest.flattened_css_transforms);
    if (!fs.existsSync(transformPath)) {
      throw new Error(`${item.slug}: flattened CSS transform manifest missing: ${packageManifest.flattened_css_transforms}`);
    }
    const transformManifest = JSON.parse(fs.readFileSync(transformPath, "utf8"));
    const recordedManifest = assetManifest.localization_transform_manifest;
    if (!recordedManifest || recordedManifest.sha256 !== sha256(transformPath)) {
      throw new Error(`${item.slug}: flattened CSS transform manifest provenance is stale`);
    }
    const expectedIds = new Set((transformManifest.transforms ?? []).map((row) => row.id));
    const appliedIds = new Set((assetManifest.localization_transforms ?? []).map((row) => row.id));
    if (expectedIds.size !== appliedIds.size || [...expectedIds].some((id) => !appliedIds.has(id))) {
      throw new Error(`${item.slug}: flattened CSS transforms were not all applied`);
    }
  }
  const pageAssetsPath = path.join(item.directory, "page-assets.json");
  if (fs.existsSync(pageAssetsPath)) {
    const pageAssets = JSON.parse(fs.readFileSync(pageAssetsPath, "utf8"));
    for (const asset of pageAssets.assets ?? []) {
      const file = path.join(assetRoot, asset.asset_file);
      if (!fs.existsSync(file) || sha256(file) !== asset.sha256) {
        throw new Error(`${item.slug}: frozen page attachment missing or corrupt: ${asset.filename}`);
      }
    }
  }
}

const cases = manifest.themes.map((theme) => ({
  slug: theme.slug,
  directory: path.resolve(root, theme.port_package_path),
  candidate: "candidate.wikidot.txt",
  css: "candidate.css",
  reference: `https://scp-wiki.wikidot.com/${theme.slug}`,
  selectors: fs.existsSync(path.join(root, theme.port_package_path, "acceptance-selectors.txt"))
    ? path.join(root, theme.port_package_path, "acceptance-selectors.txt")
    : sharedSelectors,
  title: theme.slug,
}));

const dear = path.join(ports, "dear-dictator");
const dearReference = JSON.parse(fs.readFileSync(path.join(dear, "reference.json"), "utf8"));
cases.push({
  slug: "theme:dear-dictator (SCP-KO)",
  directory: dear,
  candidate: "candidate.wikidot.txt",
  css: "candidate.css",
  reference: dearReference.reference_url,
  selectors: path.join(dear, "acceptance-selectors.txt"),
  title: "敬愛する独裁者 テーマ",
  socket: dearSocket,
});

if (process.argv.includes("--maintained")) {
  const directory = path.join(ports,"quand-le-soleil-se-couche");
  const foreign = JSON.parse(fs.readFileSync(path.join(directory,"manifest.json"),"utf8"));
  cases.push({slug:"theme:quand-le-soleil-se-couche (SCP-FR)",directory,candidate:"candidate.wikidot.txt",css:"candidate.css",reference:foreign.source_url,selectors:path.join(directory,"acceptance-selectors.txt"),surfaceContract:path.join(directory,"surface-contract.json"),title:"Quand le Soleil se couche",socket:process.env.THEME_LAB_FR_SOCKET ?? socket});
}
const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
const noVisual = process.argv.includes("--no-visual");
const iteration = process.argv.includes("--iteration");
const verifyOnly = process.argv.includes("--verify-only");
const selectedCases = only ? cases.filter((item) => item.slug === only) : cases;
if (only && selectedCases.length !== 1) throw new Error(`unknown --only theme: ${only}`);

const failures = [];
const summaries = [];
for (const item of selectedCases) {
  assertPublishablePackage(path.basename(item.directory), {checkOutputs: true});
  verifyFrozenPackage(item, {requireDaemonAssets: !verifyOnly});
  if (verifyOnly) {
    summaries.push({slug: item.slug, status: "verified"});
    process.stdout.write(`${JSON.stringify(summaries.at(-1))}\n`);
    continue;
  }
  const args = [
    lab, "check", "--socket", item.socket ?? socket, "--site-id", String(siteId),
    "--wikitext", path.join(item.directory, item.candidate),
    "--css", path.join(item.directory, item.css),
    "--reference", item.reference, "--offline", "--selectors", item.selectors,
    "--title", item.title, "--compact", ...(noVisual ? [] : ["--visual"]), "--artifact-dir", runArtifactRoot ? path.join(runArtifactRoot, path.basename(item.directory)) : path.join(item.directory, "artifacts"),
  ];
  if (item.surfaceContract) args.push("--surface-contract",item.surfaceContract);
  const structureFile=path.join(item.directory,"acceptance-structure.json");
  if(fs.existsSync(structureFile))args.push("--source-structure",structureFile);
  const baseCssFile = path.join(item.directory,"candidate-base.css");
  if (fs.existsSync(baseCssFile)) args.push("--css-base",baseCssFile);
  if (iteration) args.push("--iteration");
  const pageAssetManifest = path.join(item.directory, "page-assets.json");
  if (fs.existsSync(pageAssetManifest)) args.push("--page-assets", pageAssetManifest);
  const result = spawnSync(process.execPath, args, {cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 16 * 1024 * 1024});
  let output;
  try { output = JSON.parse(result.stdout); } catch {
    failures.push({slug: item.slug, reason: result.error?.message ?? result.stderr ?? "invalid JSON output", exit_code: result.status});
    summaries.push({slug: item.slug, status: "error"});
    process.stdout.write(`${JSON.stringify(summaries.at(-1))}\n`);
    continue;
  }
  if (output.ok === false) {
    const row = {slug: item.slug, status: "error", error: output.error, exit_code: result.status};
    failures.push(row); summaries.push(row); process.stdout.write(`${JSON.stringify(row)}\n`); continue;
  }
  const verdict = output.result ?? output;
  const external = verdict.assets?.external_requests ?? verdict.asset_summary?.external_requests ?? 0;
  const localAcceptanceStatus = verdict.target_acceptance?.status ?? "unknown";
  const decisionIssues = (verdict.top_issues ?? []).filter((issue) => issue.parity_review?.may_treat_differences_as_port_requirements === true);
  const warningIssues = decisionIssues.filter((issue) => issue.severity === "warn");
  const errorIssues = decisionIssues.filter((issue) => issue.severity === "error");
  const missingAssets = verdict.assets?.candidate?.missing?.length ?? 0;
  const row = {
    slug: item.slug,
    verdict: verdict.overall_acceptance?.status ?? "inconclusive",
    overall_acceptance: verdict.overall_acceptance ?? {status: "inconclusive"},
    verification_scope: verdict.verification_scope ?? null,
    target_fixture_identity: verdict.target_fixture_identity ?? null,
    candidate_source_sha256: sha256(path.join(item.directory,path.basename(item.directory)==="dear-dictator"||path.basename(item.directory)==="quand-le-soleil-se-couche" ? "candidate.wikidot.txt" : "candidate.wikidot.source.txt")),
    candidate_css_sha256: sha256(path.join(item.directory,item.css)),
    candidate_base_css_sha256: fs.existsSync(baseCssFile) ? sha256(baseCssFile) : null,
    candidate_preview_sha256: sha256(path.join(item.directory,item.candidate)),
    port_decision: verdict.port_decision ?? null,
    parity_gate: verdict.parity_gate ?? null,
    local_target_acceptance: verdict.target_acceptance ?? null,
    local_target_acceptance_status: localAcceptanceStatus,
    errors: errorIssues.length,
    next_actions: verdict.next_actions?.length ?? 0,
    torture: verdict.torture?.verdict ?? "unknown",
    external_requests: external,
    missing_candidate_assets: missingAssets,
    viewport_status: verdict.viewport_status ?? null,
    font_diagnostics: verdict.font_diagnostics ?? null,
    interaction_diagnostics: verdict.interaction_diagnostics ?? null,
    image_diagnostics: verdict.image_diagnostics ?? null,
    page_image_assets: verdict.page_image_assets ?? null,
    acceptance_selector_file: path.relative(root, item.selectors),
    warning_issues: warningIssues,
    style_changes: verdict.style_changes ?? [],
    candidate_assets: verdict.assets?.candidate ?? null,
    reference_asset_failures: verdict.assets?.failed ?? [],
    blocked_external_attempts: verdict.assets?.browser_blocked_external_attempts ?? 0,
    visual: verdict.visual ?? null,
    timing_ms: verdict.timing_ms ?? null,
  };
  const viewportFailed = !iteration && Object.values(row.viewport_status ?? {}).some((entry) => entry.status !== "pass");
  const fontFailed = row.font_diagnostics?.status !== "measured" || !row.font_diagnostics.fonts?.some((font) => font.glyph_count > 0);
  const interactionFailed = !iteration && Object.values(row.interaction_diagnostics ?? {}).some((entry) => entry.status === "fail");
  const imageFailed = (row.image_diagnostics?.broken?.length ?? 0) > 0;
  const failed = result.status !== 0 || row.verdict === "fail" || row.verdict === "inconclusive" || localAcceptanceStatus === "fail" || row.errors > 0 || row.next_actions > 0 || (!iteration && !["pass", "warn"].includes(row.torture)) || external !== 0 || missingAssets > 0 || viewportFailed || fontFailed || interactionFailed || imageFailed;
  row.status = failed ? "fail" : iteration ? "iteration-verdict" : row.verdict === "warn" ? "warn-no-actionable-issues" : "pass";
  if (failed) failures.push({...row, exit_code: result.status, stderr: result.stderr?.slice(0, 500)});
  summaries.push(row);
  process.stdout.write(`${JSON.stringify(row)}\n`);
}

process.stdout.write(`${JSON.stringify({summary: {
  total: summaries.length,
  mode: verifyOnly ? "verify-only" : iteration ? "iteration" : "full-acceptance",
  verified: summaries.filter((row) => row.status === "verified").length,
  pass: summaries.filter((row) => row.status === "pass").length,
  warn_no_actionable_issues: summaries.filter((row) => row.status === "warn-no-actionable-issues").length,
  failed: failures.length,
}, failures})}\n`);
process.exitCode = failures.length ? 1 : 0;
