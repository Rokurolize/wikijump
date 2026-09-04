#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import https from "node:https";
import path from "node:path";

const ASSETS = Object.freeze([
  Object.freeze({ page: "scp-744", filename: "744-Thumbnail.png", size: 453461, sha256: "cfe99cddee4cfd5b20e40ac53447d33c33c716f531b31036552226c035233b12" }),
  Object.freeze({ page: "scp-744", filename: "Cernunnos.svg", size: 2263, sha256: "bba853a252fa5b87c853cc6a37755f558507d9345af0f00f4d551525f90a9b84" }),
  Object.freeze({ page: "scp-744", filename: "Factory.png", size: 812113, sha256: "26524187545185187760f1be56f79def1b1f092ddeb6adadf5dcf6338b633f7c" }),
  Object.freeze({ page: "fragment:2117-1", filename: "2117.png", size: 496537, sha256: "a983e8b6f65dab350f950f2ab898f399f2aff6f806f3c680fd22d70140f42e73" }),
  Object.freeze({ page: "scp-5516", filename: "Lobster", size: 181590, sha256: "f6865aa775dc64a528b30fc5c6ced0da7c73461aa4f1e5369383127275a2b12c" }),
  Object.freeze({ page: "scp-9506", filename: "NFSI.png", size: 179159, sha256: "7c8b350a8bbc8be24e93889ff6e98a3b695677d1182398fe4ac0448ad9964c68" }),
]);

function usage() {
  return "Usage: capture-compatibility-canary-assets.mjs --origin https://HOST[:PORT] --output-dir DIR --receipt FILE [--insecure-localhost]";
}

export function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const result = { insecureLocalhost: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--insecure-localhost") {
      if (result.insecureLocalhost) throw new Error(usage());
      result.insecureLocalhost = true;
      continue;
    }
    if (!["--origin", "--output-dir", "--receipt"].includes(flag) || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(usage());
    const key = flag.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase());
    if (result[key] !== undefined) throw new Error(usage());
    result[key] = argv[++index];
  }
  if (!result.origin || !result.outputDir || !result.receipt) throw new Error(usage());
  const origin = new URL(result.origin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("--origin must be one HTTPS origin");
  if (result.insecureLocalhost && !origin.hostname.endsWith(".localhost")) throw new Error("--insecure-localhost is limited to .localhost origins");
  return { ...result, origin: origin.origin, outputDir: path.resolve(result.outputDir), receipt: path.resolve(result.receipt) };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fetchBytes(url, { insecureLocalhost }) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { rejectUnauthorized: !insecureLocalhost }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`${url.href}: expected HTTP 200, got ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("error", reject);
  });
}

export async function captureCompatibilityCanaryAssets(args) {
  await fs.mkdir(path.dirname(args.outputDir), { recursive: true, mode: 0o700 });
  await fs.mkdir(args.outputDir, { recursive: false, mode: 0o700 });
  const captured = [];
  try {
    for (const asset of ASSETS) {
      const resourcePath = `/local--files/${encodeURIComponent(asset.page).replaceAll("%3A", ":")}/${encodeURIComponent(asset.filename)}`;
      const url = new URL(resourcePath, args.origin);
      const bytes = await fetchBytes(url, args);
      const observed = { size: bytes.byteLength, sha256: sha256(bytes) };
      if (observed.size !== asset.size || observed.sha256 !== asset.sha256) {
        throw new Error(`${asset.page}/${asset.filename}: byte identity drifted: expected ${asset.size}/${asset.sha256}, got ${observed.size}/${observed.sha256}`);
      }
      const target = path.join(args.outputDir, asset.filename);
      await fs.writeFile(target, bytes, { mode: 0o600, flag: "wx" });
      captured.push({ ...asset, url: url.href });
    }
    const receipt = {
      schema: "wikijump.compatibility_canary_asset_capture.v1",
      status: "pass",
      captured_at: new Date().toISOString(),
      source_origin: args.origin,
      insecure_localhost: args.insecureLocalhost,
      output_dir: args.outputDir,
      assets: captured,
    };
    await fs.writeFile(args.receipt, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    return receipt;
  } catch (error) {
    await fs.rm(args.outputDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return;
  }
  const receipt = await captureCompatibilityCanaryAssets(args);
  console.log(JSON.stringify(receipt));
}

main(process.argv.slice(2)).catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
