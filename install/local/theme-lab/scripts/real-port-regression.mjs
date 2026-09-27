#!/usr/bin/env node

// Sequential, receipt-driven campaign runner. Each case uses the existing
// persistent Theme Lab daemon and an already acquired offline reference.
import fs from "node:fs";
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
const sharedSelectors = path.join(ports, "shared-acceptance-selectors.txt");
const lab = path.join(root, "install/local/theme-lab/scripts/theme-lab.mjs");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const assetRoot = path.resolve(process.env.THEME_LAB_ASSET_DIR ?? path.join(ports, "shared-replay-assets"));
const assetByDigest = new Map();
for (const name of fs.readdirSync(assetRoot)) {
  const digest = name.match(/^([0-9a-f]{64})\./u)?.[1];
  if (digest && !assetByDigest.has(digest)) assetByDigest.set(digest, name);
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

function verifyFrozenPackage(item) {
  if (item.slug === "theme:dear-dictator (SCP-KO)") return;
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
  for (const asset of assetManifest.assets ?? []) {
    const filename = assetByDigest.get(asset.sha256);
    if (!filename || sha256(path.join(assetRoot, filename)) !== asset.sha256) {
      throw new Error(`${item.slug}: frozen CSS asset missing or corrupt: ${asset.sha256}`);
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
  verifyFrozenPackage(item);
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
    "--title", item.title, "--compact", ...(noVisual ? [] : ["--visual"]), "--artifact-dir", path.join(item.directory, "artifacts"),
  ];
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
  const verdict = output.result ?? output;
  const external = verdict.assets?.external_requests ?? verdict.asset_summary?.external_requests ?? 0;
  const warningIssues = (verdict.top_issues ?? []).filter((issue) => issue.severity === "warn");
  const errorIssues = (verdict.top_issues ?? []).filter((issue) => issue.severity === "error");
  const missingAssets = verdict.assets?.candidate?.missing?.length ?? 0;
  const row = {
    slug: item.slug,
    verdict: verdict.verdict ?? "unknown",
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
  const failed = result.status !== 0 || row.verdict === "fail" || row.errors > 0 || row.next_actions > 0 || (!iteration && row.torture !== "pass") || external !== 0 || missingAssets > 0 || viewportFailed || fontFailed || interactionFailed || imageFailed;
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
