import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function shippedSourceFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push(...shippedSourceFiles(fullPath));
    } else if (/\.(?:js|ts|svelte|html|scss|css)$/.test(entry.name)) {
      output.push(fullPath);
    }
  }
  return output;
}

test("the local emulator ships no Google Analytics beacon", () => {
  const forbidden = [
    /google-analytics\.com/i,
    /googletagmanager\.com\/gtag/i,
    /\bgtag\s*\(/i,
    /\bga\s*\(\s*["']create["']/i,
    /analytics\.js/i,
  ];

  for (const file of shippedSourceFiles(path.join(root, "src"))) {
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${file} must not enable tracking`);
    }
  }
});

