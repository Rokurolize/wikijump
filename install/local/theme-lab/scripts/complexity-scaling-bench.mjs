// Reproducible old/new measurements for the selector and original-URL indices.
// The old ReferenceCache is loaded from Git without changing the worktree.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {fileURLToPath, pathToFileURL} from "node:url";

import {firstRulesForSelectors} from "../src/css-probe.mjs";
import {ReferenceCache as NewCache, sha256Hex} from "../src/reference-cache.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../../..");
const revision = process.env.BASELINE_REVISION ?? "6112a90d88ecd087a465421f87afdd44e847a6dc";
const oldSource = execFileSync(
  "git",
  ["show", `${revision}:install/local/theme-lab/src/reference-cache.mjs`],
  {cwd: repoRoot, encoding: "utf8"},
);
const reboundSource = oldSource.replace(
  'from "./errors.mjs"',
  `from "${pathToFileURL(path.resolve(scriptDir, "../src/errors.mjs")).href}"`,
);
assert.notEqual(reboundSource, oldSource);
const {ReferenceCache: OldCache} = await import(
  `data:text/javascript;base64,${Buffer.from(reboundSource).toString("base64")}`
);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.floor(sorted.length / 2)].toFixed(3));
}

function selectorRows(n) {
  const rules = Array.from({length: n}, (_, i) => ({selector: `.s${i}`, atContext: [`@media ${i}`]}));
  const selectors = rules.map((rule) => rule.selector);
  const oldTimes = [];
  const newTimes = [];
  for (let sample = 0; sample < 7; sample += 1) {
    let start = performance.now();
    let old;
    for (let i = 0; i < 20; i += 1) {
      old = selectors.map((selector) => rules.find((rule) => rule.selector === selector) ?? {selector, atContext: []});
    }
    oldTimes.push((performance.now() - start) / 20);
    start = performance.now();
    let fresh;
    for (let i = 0; i < 20; i += 1) fresh = firstRulesForSelectors(rules, selectors);
    newTimes.push((performance.now() - start) / 20);
    assert.deepEqual(fresh, old);
  }
  return {n, old_ms: median(oldTimes), new_ms: median(newTimes), old_comparisons: n * (n + 1) / 2, new_index_inserts: n, new_lookups: n};
}

async function urlRows(n) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-theme-url-bench-"));
  try {
    const body = Buffer.from("same content for every original URL");
    const digest = sha256Hex(body);
    const urls = Array.from({length: n}, (_, i) => `https://example.com/asset-${i}`);
    const times = {old: [], fresh: []};
    for (let sample = 0; sample < 5; sample += 1) {
      for (const [name, Cache] of [["old", OldCache], ["fresh", NewCache]]) {
        const cache = new Cache({cacheDir: path.join(root, `${name}-${sample}`)});
        await cache.load();
        const start = performance.now();
        for (const url of urls) await cache.storeObject(body, "text/css", {originalUrl: url});
        times[name].push(performance.now() - start);
        assert.deepEqual(cache.manifest.objects[digest].original_urls, urls);
      }
    }
    return {n, old_ms: median(times.old), new_ms: median(times.fresh), old_includes_comparisons: n * (n - 1) / 2, new_set_probes: n};
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
}

const results = {revision, selectors: [], original_urls: []};
for (const n of [100, 200, 400, 800]) results.selectors.push(selectorRows(n));
for (const n of [200, 400, 800, 1600]) results.original_urls.push(await urlRows(n));
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
