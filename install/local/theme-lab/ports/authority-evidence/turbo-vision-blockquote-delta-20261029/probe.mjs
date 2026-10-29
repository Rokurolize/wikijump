
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawn, execFileSync} from "node:child_process";
const WT_TL = "/home/roku/.local/state/wikijump/agents/worktrees/freeze3-tv/install/local/theme-lab";
const RT_LAB = "/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/install/local/theme-lab";
const outDir = path.join(WT_TL, "ports/authority-evidence/turbo-vision-blockquote-delta-20261029");
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const contract = JSON.parse(fs.readFileSync(path.join(RT_LAB, "ports/current-acceptance/run-contract-campaign-20261028-s9.json"), "utf8"));
const fixtureUrl = new URL("/run-owned%3Atheme-lab-visual-acceptance-imported-20260924", contract.target_site.origin).href;
const oldCss = fs.readFileSync("/tmp/tv-candidate-old.css", "utf8");
const comment = "/* SCP-JP Wikidot Turbo Vision documentation blockquote wrap: owner OPTION C (2026-10-29) \u2014 wrap long unbroken strings in blockquotes so they read in place at narrow widths; a localization quality improvement, divergence from verbatim upstream accepted for this package + finding. */";
const rule = ".turbo-block .blockquote, .turbo-block .blockquote * { overflow-wrap: anywhere; }";
const newCss = oldCss.replace(/\s*$/u, "") + "\n/* THEME_LAB_AUTHORITY_BLOCK_BOUNDARY */\n" + comment + "\n" + rule + "\n";
fs.writeFileSync("/tmp/tv-candidate-new.css", newCss);
const dockerEnv = execFileSync("docker", ["inspect", "wikijump-local-development-deepwell-1", "--format", "{{range .Config.Env}}{{println .}}{{end}}"], {encoding: "utf8"});
const token = dockerEnv.split(/\r?\n/u).find(l => l.startsWith("DEEPWELL_RPC_TOKEN="))?.slice("DEEPWELL_RPC_TOKEN=".length);
if (!token) throw new Error("RPC token unavailable");
const env = {...process.env, DEEPWELL_RPC_TOKEN: token};
const socket = "/tmp/tv-probe.sock";
try { fs.unlinkSync(socket); } catch {}
const assetDir = "/tmp/tv-probe-assets";
const logFd = fs.openSync("/tmp/tv-probe-daemon.log", "a");
const daemon = spawn(process.execPath, ["scripts/theme-lab.mjs", "serve", "--socket", socket, "--candidate-url", fixtureUrl, "--browser-root", "../../../framerail", "--asset-dir", assetDir, "--header-html", "fixtures/scp-jp-header.html", "--navigation-html", "fixtures/scp-jp-navigation.html", "--sidebar-html", "fixtures/scp-jp-sidebar.html", "--baseline-css", "fixtures/scp-jp-sigma9-offline.css", "--allow-private"], {cwd: RT_LAB, env, stdio: ["ignore", logFd, logFd]});
import {spawnSync} from "node:child_process";
let cliSeq = 0;
function cli(args, {okCodes = [0]} = {}) {
  const outFile = "/tmp/tv-cli-" + (cliSeq++) + ".json";
  const fd = fs.openSync(outFile, "w");
  const run = spawnSync(process.execPath, ["scripts/theme-lab.mjs", ...args], {cwd: RT_LAB, env, stdio: ["ignore", fd, "inherit"], timeout: 300000});
  fs.closeSync(fd);
  const text = fs.readFileSync(outFile, "utf8");
  try { return JSON.parse(text); } catch { throw new Error("cli " + args[0] + " unparseable output (status " + run.status + ", bytes " + text.length + "): " + text.slice(0, 300)); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const started = Date.now();
  while (!fs.existsSync(socket)) { if (daemon.exitCode !== null) throw new Error("daemon exited " + daemon.exitCode + "; see /tmp/tv-probe-daemon.log"); if (Date.now() - started > 30000) throw new Error("daemon socket timeout"); await sleep(150); }
  const selFile = "/tmp/tv-probe-selectors.txt";
  fs.writeFileSync(selFile, ["div.turbo-block.bg-yellow > div.blockquote", ".turbo-block .blockquote", "div.turbo-block.bg-yellow > div.blockquote span", ".turbo-block"].join("\n") + "\n");
  console.log("open:", JSON.stringify(cli(["open", "--socket", socket, "--url", fixtureUrl])).slice(0, 200));
  const preview = cli(["preview", "--socket", socket, "--site-id", "6000003", "--title", "Preview", "--file", path.join(WT_TL, "ports/turbo-vision/candidate.wikidot.txt")]);
  console.log("preview ok:", preview.ok, JSON.stringify(preview.result ?? preview).slice(0, 200));
  const variants = {};
  for (const [variant, cssFile] of [["without", "/tmp/tv-candidate-old.css"], ["with", "/tmp/tv-candidate-new.css"]]) {
    cli(["css", "--socket", socket, "--file", cssFile]);
    const probes = {};
    for (const [name, selector] of [["blockquote", "div.turbo-block.bg-yellow > div.blockquote"], ["approved", ".turbo-block .blockquote"], ["span", "div.turbo-block.bg-yellow > div.blockquote span"]]) {
      probes[name] = cli(["probe", "--socket", socket, "--selector", selector, "--property", "overflow-wrap", "--viewport", "320x800"]).result;
    }
    const snap = null;
    const shotPath = path.join(outDir, variant + "-320.png");
    cli(["screenshot", "--socket", socket, "--path", shotPath, "--viewport", "320x800"]);
    // check-op geometry for this variant
    const artifactDir = path.join(outDir, "check-" + variant);
    fs.mkdirSync(artifactDir, {recursive: true});
    const checkDoc = cli(["check", "--socket", socket, "--site-id", "6000003", "--title", "Preview", "--css", cssFile, "--wikitext", path.join(WT_TL, "ports/turbo-vision/candidate.wikidot.txt"), "--source", path.join(WT_TL, "ports/turbo-vision/candidate.wikidot.source.txt"), "--reference", "https://scp-wiki.wikidot.com/theme:turbo-vision", "--offline", "--selectors", path.join(RT_LAB, "ports/shared-acceptance-selectors.txt"), "--surface-contract", "auto", "--visual", "--artifact-dir", artifactDir, "--json-full", "--compact"], {okCodes: [0, 1, 2]});
    fs.writeFileSync(path.join(artifactDir, "check.json"), JSON.stringify(checkDoc, null, 2) + "\n");
    const result = checkDoc.result ?? checkDoc;
    const errors = (result.target_acceptance?.findings ?? []).filter(f => f.severity === "error");
    variants[variant] = {css_sha256: sha(fs.readFileSync(cssFile)), probes, selector_counts: snap?.selector_counts ?? null, check: {verdict: result.verdict ?? checkDoc.verdict, error_kinds: errors.map(f => f.kind + "@" + (f.viewport ?? "?")), viewport_overflow: errors.filter(f => f.kind === "viewport_overflow").map(f => ({viewport: f.viewport, overflow_px: f.overflow_px, sources: f.overflow_sources})), check_sha256: sha(fs.readFileSync(path.join(artifactDir, "check.json")))}, screenshot_sha256: sha(fs.readFileSync(shotPath))};
    console.log(variant, JSON.stringify({probes: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, {matched: v?.matched, computed: v?.computed, rect: v?.rect}])), counts: variants[variant].selector_counts, errors: variants[variant].check.error_kinds}));
  }
  const receipt = {
    schema: "theme_lab_jp_correction_delta.v1",
    decision_authority: "OWNER_OPTION_C_2026-10-29",
    measured_at: new Date().toISOString(),
    scenario: "turbo-vision-blockquote-wrap",
    frame: "theme-lab session daemon on the campaign Sigma-9 runtime contract fixture (run-owned acceptance page, candidate wikitext preview, candidate CSS set via the session)",
    fixture_url: fixtureUrl,
    correction: comment + "\n" + rule,
    correction_sha256: sha(comment + "\n" + rule),
    audit_reference: {raw_result: "ports/current-acceptance/turbo-vision/runs/w16-turbo-vision-full/raw-result.json", sha256: "cf8b7993005e195e2805808e0953d39913ea0cb70e3873e81b5af6ee5173d9eb", span_rect: {left: 60, right: 333, width: 273}, document_overflow_px: 13},
    variants,
    verdict: {
      coverage_selector_matches_fixture_blockquote: variants.with.probes.approved?.matched === 1 && variants.with.probes.blockquote?.matched === 1,
      without_defect_reproduced: variants.without.check.viewport_overflow.some(f => f.viewport === "narrow-mobile" && f.overflow_px === 13),
      with_correction_clears_defect: variants.with.check.viewport_overflow.length === 0,
      with_computed_overflow_wrap_anywhere: variants.with.probes.blockquote?.computed === "anywhere" && variants.with.probes.span?.computed === "anywhere",
      without_computed_overflow_wrap_normal: variants.without.probes.blockquote?.computed !== "anywhere",
    },
  };
  receipt.verdict.pass = receipt.verdict.coverage_selector_matches_fixture_blockquote && receipt.verdict.without_defect_reproduced && receipt.verdict.with_correction_clears_defect && receipt.verdict.with_computed_overflow_wrap_anywhere;
  fs.writeFileSync(path.join(outDir, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n");
  console.log("VERDICT", JSON.stringify(receipt.verdict, null, 2));
} finally {
  try { cli(["stop", "--socket", socket]); } catch {}
  if (daemon.exitCode === null) daemon.kill("SIGTERM");
  fs.closeSync(logFd);
  try { fs.unlinkSync(socket); } catch {}
}
