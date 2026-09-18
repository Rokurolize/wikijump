import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const ROOT = fileURLToPath(new URL("../src/", import.meta.url));
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));
const MAX_BROWSER_PHASE_TIMEOUT_MS = 60_000;
const MAX_OPERATOR_BROWSER_TIMEOUT_MS = 120_000;

function candidateRuntimeFiles() {
  return fs.readdirSync(ROOT)
    .filter((name) => name.endsWith(".mjs"))
    .filter((name) =>
      (name.startsWith("open43-") && (name.includes("candidate") || name.includes("browser"))) ||
      new Set([
        "candidate-browser-contexts.mjs",
        "candidate-case-http.mjs",
        "comments-hideform-browser-candidate-case-set.mjs",
        "ftml-marker-contract-candidate-case-set.mjs",
      ]).has(name),
    )
    .map((name) => path.join(ROOT, name));
}

test("candidate browser failure paths stay within the one-minute phase budget", () => {
  const offenders = [];
  for (const file of candidateRuntimeFiles()) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\b(\d[\d_]*)\b/gu)) {
      const value = Number(match[1].replaceAll("_", ""));
      const context = source.slice(Math.max(0, match.index - 80), match.index + match[0].length + 80);
      if (value > MAX_BROWSER_PHASE_TIMEOUT_MS && /timeout|TIMEOUT/u.test(context) && !/CARGO_TIMEOUT_MS/u.test(context)) {
        offenders.push(`${path.basename(file)}:${match[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("candidate browser settling uses conditions instead of multi-second fixed sleeps", () => {
  const offenders = [];
  for (const file of candidateRuntimeFiles()) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:waitForTimeout|settleMs\s*:)[^(\d]*\(?\s*(\d[\d_]*)/gu)) {
      const value = Number(match[1].replaceAll("_", ""));
      if (value > 1_000) offenders.push(`${path.basename(file)}:${match[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("operator browser capture failure paths stay within two minutes", () => {
  const files = [
    path.join(ROOT, "standing-browser-canaries.mjs"),
    path.join(REPOSITORY_ROOT, "install/local/wikidot-verification/scripts/capture-browser-rendering.mjs"),
    path.join(REPOSITORY_ROOT, "install/local/wikidot-verification/scripts/capture-sandbox-oracle.mjs"),
  ];
  const offenders = [];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?:timeout(?:Ms)?\s*[:=]|TIMEOUT_MS\s*=|withTimeout\([^,]+,)\s*(\d[\d_]*)/gu)) {
      const value = Number(match[1].replaceAll("_", ""));
      if (value > MAX_OPERATOR_BROWSER_TIMEOUT_MS) {
        offenders.push(`${path.relative(REPOSITORY_ROOT, file)}:${match[1]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});


test("focused Cargo child commands stay within the thirty-second failure budget", () => {
  const files = [
    "open43-a1030-rate-candidate-case-set.mjs",
    "open43-issue1060-register-join-create-candidate-case-set.mjs",
  ];
  for (const name of files) {
    const source = fs.readFileSync(path.join(ROOT, name), "utf8");
    const match = /const CARGO_TIMEOUT_MS = (\d[\d_]*);/u.exec(source);
    assert.ok(match, `${name} must declare CARGO_TIMEOUT_MS`);
    assert.ok(Number(match[1].replaceAll("_", "")) <= 30_000, `${name} Cargo timeout exceeds thirty seconds`);
  }
});
