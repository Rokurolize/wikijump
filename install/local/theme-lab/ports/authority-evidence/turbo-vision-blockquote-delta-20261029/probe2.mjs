
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {spawn, spawnSync, execFileSync} from "node:child_process";
const WT_TL = "/home/roku/.local/state/wikijump/agents/worktrees/freeze3-tv/install/local/theme-lab";
const RT_LAB = "/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/install/local/theme-lab";
const outDir = path.join(WT_TL, "ports/authority-evidence/turbo-vision-blockquote-delta-20261029");
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const contract = JSON.parse(fs.readFileSync(path.join(RT_LAB, "ports/current-acceptance/run-contract-campaign-20261028-s9.json"), "utf8"));
const fixtureUrl = new URL("/run-owned%3Atheme-lab-visual-acceptance-imported-20260924", contract.target_site.origin).href;
const dockerEnv = execFileSync("docker", ["inspect", "wikijump-local-development-deepwell-1", "--format", "{{range .Config.Env}}{{println .}}{{end}}"], {encoding: "utf8"});
const token = dockerEnv.split(/\r?\n/u).find(l => l.startsWith("DEEPWELL_RPC_TOKEN="))?.slice("DEEPWELL_RPC_TOKEN=".length);
const env = {...process.env, DEEPWELL_RPC_TOKEN: token};
const socket = "/tmp/tv-probe2.sock";
try { fs.unlinkSync(socket); } catch {}
const logFd = fs.openSync("/tmp/tv-probe2-daemon.log", "a");
const daemon = spawn(process.execPath, ["scripts/theme-lab.mjs", "serve", "--socket", socket, "--candidate-url", fixtureUrl, "--browser-root", "../../../framerail", "--asset-dir", "/tmp/tv-probe-assets", "--header-html", "fixtures/scp-jp-header.html", "--navigation-html", "fixtures/scp-jp-navigation.html", "--sidebar-html", "fixtures/scp-jp-sidebar.html", "--baseline-css", "fixtures/scp-jp-sigma9-offline.css", "--allow-private"], {cwd: RT_LAB, env, stdio: ["ignore", logFd, logFd]});
let seq = 100;
function cli(args) {
  const outFile = "/tmp/tv-cli-" + (seq++) + ".json";
  const fd = fs.openSync(outFile, "w");
  const run = spawnSync(process.execPath, ["scripts/theme-lab.mjs", ...args], {cwd: RT_LAB, env, stdio: ["ignore", fd, "inherit"], timeout: 120000});
  fs.closeSync(fd);
  return JSON.parse(fs.readFileSync(outFile, "utf8"));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const started = Date.now();
  while (!fs.existsSync(socket)) { if (daemon.exitCode !== null) throw new Error("daemon exited"); if (Date.now() - started > 30000) throw new Error("timeout"); await sleep(150); }
  cli(["open", "--socket", socket, "--url", fixtureUrl]);
  cli(["preview", "--socket", socket, "--site-id", "6000003", "--title", "Preview", "--file", path.join(WT_TL, "ports/turbo-vision/candidate.wikidot.txt")]);
  cli(["css", "--socket", socket, "--file", "/tmp/tv-candidate-new.css"]);
  const probes = {};
  for (const [name, selector] of [["blockquote", "div.turbo-block.bg-yellow > div.blockquote"], ["approved", ".turbo-block .blockquote"], ["span", "div.turbo-block.bg-yellow > div.blockquote span"]]) {
    probes[name] = cli(["probe", "--socket", socket, "--selector", selector, "--property", "overflow-wrap", "--viewport", "320x800"]).result;
  }
  const shotPath = path.join(outDir, "with-320.png");
  cli(["screenshot", "--socket", socket, "--path", shotPath, "--viewport", "320x800"]);
  const receiptPath = path.join(outDir, "receipt.json");
  const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  receipt.variants.with.probes = probes;
  receipt.variants.with.screenshot_sha256 = sha(fs.readFileSync(shotPath));
  receipt.variants.with.probe_note = "Re-probed in a fresh session (probe2) after the first with-variant probe ran against the page state left by the preceding check op and matched 0; the with-variant check-op result (zero error findings) was self-contained and is unchanged.";
  receipt.verdict.coverage_selector_matches_fixture_blockquote = probes.approved?.matched === 1 && probes.blockquote?.matched === 1;
  receipt.verdict.with_computed_overflow_wrap_anywhere = probes.blockquote?.computed === "anywhere" && probes.span?.computed === "anywhere";
  receipt.verdict.pass = receipt.verdict.coverage_selector_matches_fixture_blockquote && receipt.verdict.without_defect_reproduced && receipt.verdict.with_correction_clears_defect && receipt.verdict.with_computed_overflow_wrap_anywhere;
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  console.log(JSON.stringify({probes: Object.fromEntries(Object.entries(probes).map(([k, v]) => [k, {matched: v?.matched, computed: v?.computed, rect: v?.rect}])), verdict: receipt.verdict}, null, 2));
} finally {
  try { cli(["stop", "--socket", socket]); } catch {}
  if (daemon.exitCode === null) daemon.kill("SIGTERM");
  fs.closeSync(logFd);
  try { fs.unlinkSync(socket); } catch {}
}
