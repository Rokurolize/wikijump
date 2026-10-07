#!/usr/bin/env node

// Agent-facing CLI for the theme-lab persistent browser session.
//
//   theme-lab serve --socket /tmp/theme-lab.sock --candidate-url URL
//   theme-lab open --url URL [--target reference]
//   theme-lab css --file candidate.css
//   theme-lab snapshot [--selectors selectors.json]
//   theme-lab diff --reference-url URL [--selectors selectors.json]
//   theme-lab screenshot --path shot.png [--viewport 1440x1000]
//   theme-lab stop
//
// Every command talks to the running session over a Unix socket and prints a
// single JSON document, so an agent can consume the verdict directly.

import fs from "node:fs";
import {execFileSync} from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import {StringDecoder} from "node:string_decoder";
import {stringifyAsciiJson} from "../src/ascii-json.mjs";

import {loadChromium} from "../src/browser-lab.mjs";
import {stopDaemon} from "../src/daemon.mjs";
import {createDeepwellPreviewClient} from "../src/deepwell-preview.mjs";
import {ThemeLabError} from "../src/errors.mjs";
import {ReferenceCache, defaultCacheDir} from "../src/reference-cache.mjs";
import {startSessionServer} from "../src/session-server.mjs";
import {loadCandidateStructure} from "../src/candidate-structure.mjs";

function parseArgs(argv) {
  const args = {_positional: []};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        args[name] = true;
      } else {
        args[name] = value;
        index += 1;
      }
    } else {
      args._positional.push(arg);
    }
  }
  return args;
}

function readSelectors(filePath) {
  const text = fs.readFileSync(path.resolve(filePath), "utf8");
  if (filePath.endsWith(".json")) return JSON.parse(text);
  return text.split("\n").map((line) => line.trim()).filter(Boolean);
}

function readSurfaceContract(value) {
  if (value === undefined || value === null || value === false) return null;
  if (["off", "none", "false"].includes(String(value).toLowerCase())) return null;
  if (value === true || value === "auto") return "auto";
  return JSON.parse(fs.readFileSync(path.resolve(String(value)), "utf8"));
}

function sendRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    let settled = false;
    socket.on("connect", () => socket.write(`${stringifyAsciiJson(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += decoder.write(chunk);
      const newline = buffer.indexOf("\n");
      if (newline === -1 || settled) return;
      settled = true;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
    socket.on("end", () => {
      if (settled) return;
      buffer += decoder.end();
      if (buffer.trim()) {
        settled = true;
        resolve(JSON.parse(buffer));
      }
    });
    socket.on("error", (error) => {
      if (settled) return;
      if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
        reject(
          new ThemeLabError(
            "no_daemon",
            `no theme-lab session at ${socketPath}; run 'theme-lab serve --socket ${socketPath} ...' first`,
          ),
        );
        return;
      }
      reject(error);
    });
  });
}

function preflightCandidateUrl(value) {
  if (typeof value !== "string" || !value) return;
  let url;
  try { url = new URL(value); } catch { throw new ThemeLabError("invalid_candidate_url", `invalid candidate URL: ${value}`); }
  if (!url.hostname.endsWith(".wikijump.localhost")) return;
  let status;
  try {
    status = Number.parseInt(execFileSync("curl", ["-ksS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "8", value], {encoding: "utf8"}).trim(), 10);
  } catch (error) {
    throw new ThemeLabError("candidate_preflight_failed", `candidate URL preflight failed: ${value}: ${error.message}`);
  }
  if (!Number.isInteger(status) || status < 200 || status >= 400) {
    throw new ThemeLabError("candidate_preflight_failed", `candidate URL returned HTTP ${Number.isInteger(status) ? status : "unknown"}: ${value}`);
  }
}

async function serve(args) {
  const socketPath = path.resolve(args.socket ?? "/tmp/theme-lab.sock");
  preflightCandidateUrl(args["candidate-url"] ?? null);
  const chromium = loadChromium(args["browser-root"] ? path.resolve(args["browser-root"]) : undefined);
  const rpcToken = args["rpc-token"] ?? process.env.DEEPWELL_RPC_TOKEN;
  const previewClient = rpcToken
    ? createDeepwellPreviewClient({
        rpcUrl: args["rpc-url"] ?? "http://127.0.0.1:2747/jsonrpc",
        rpcToken,
      })
    : null;
  if (!previewClient) {
    process.stderr.write(
      "warning: DEEPWELL_RPC_TOKEN is not set; preview/torture/check will report no_preview_client\n",
    );
  }
  const referenceAssets = new ReferenceCache({
    cacheDir: args["cache-dir"] ? path.resolve(args["cache-dir"]) : defaultCacheDir(),
    allowPrivate: args["allow-private"] === true,
  });
  const server = await startSessionServer({
    socketPath,
    chromium,
    cdpEndpoint: args["cdp-endpoint"] ?? null,
    executablePath: args["browser-executable"] ? path.resolve(args["browser-executable"]) : null,
    headless: args["headed"] !== true,
    candidateUrl: args["candidate-url"] ?? null,
    previewClient,
    referenceAssets,
    assetDir: args["asset-dir"] ? path.resolve(args["asset-dir"]) : null,
    sidebarHtml: args["sidebar-html"] ? fs.readFileSync(path.resolve(args["sidebar-html"]), "utf8") : null,
    interwikiHtml: args["interwiki-html"] ? fs.readFileSync(path.resolve(args["interwiki-html"]), "utf8") : null,
    headerHtml: args["header-html"] ? fs.readFileSync(path.resolve(args["header-html"]), "utf8") : null,
    baselineCss: args["baseline-css"] ? fs.readFileSync(path.resolve(args["baseline-css"]), "utf8") : null,
    navigationHtml: args["navigation-html"] ? fs.readFileSync(path.resolve(args["navigation-html"]), "utf8") : null,
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      socket: socketPath,
      pid: process.pid,
      rpc_configured: Boolean(previewClient),
    })}\n`,
  );
  // The socket listener keeps the event loop alive; block until a signal so the
  // session survives across CLI invocations.
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } catch {
      // best-effort cleanup
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  await new Promise(() => {});
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (!command || command === "help" || args.help) {
    process.stdout.write(
      "commands: serve | open | check | css | clear-css | preview | torture | reference | viewport | snapshot | probe | diff | screenshot | status | stop\n",
    );
    return 0;
  }
  if (command === "serve") {
    await serve(args);
    return 0;
  }

  const socketPath = path.resolve(args.socket ?? "/tmp/theme-lab.sock");

  if (command === "stop") {
    const result = await stopDaemon(socketPath);
    process.stdout.write(`${JSON.stringify({ok: true, ...result}, null, args.compact ? 0 : 2)}\n`);
    return 0;
  }

  let request;
  if (command === "open") {
    request = {op: "open", target: args.target ?? "candidate", url: args.url, viewport: parseViewport(args.viewport)};
  } else if (command === "css") {
    const css = args.file ? fs.readFileSync(path.resolve(args.file), "utf8") : args.text;
    if (typeof css !== "string") throw new Error("css requires --file or --text");
    const tortureSiteId = args["torture-site-id"]
      ? Number.parseInt(args["torture-site-id"], 10)
      : null;
    if (args["torture-site-id"] && !Number.isInteger(tortureSiteId)) {
      throw new Error("--torture-site-id must be an integer");
    }
    request = {
      op: "set_css",
      css,
      tortureSiteId,
      tortureSyntaxOnly: args["torture-syntax-only"] === true,
    };
  } else if (command === "clear-css") {
    request = {op: "clear_css"};
  } else if (command === "preview") {
    const wikitext = args.file ? fs.readFileSync(path.resolve(args.file), "utf8") : args.text;
    if (typeof wikitext !== "string") throw new Error("preview requires --file or --text");
    request = {
      op: "preview",
      siteId: parseSiteId(args["site-id"]),
      title: args.title ?? "Preview",
      wikitext,
      syntaxOnly: args["syntax-only"] === true,
      containerSelector: args.container ?? "#page-content",
    };
  } else if (command === "torture") {
    request = {
      op: "torture",
      siteId: parseSiteId(args["site-id"]),
      title: args.title ?? "Theme Lab Torture",
      syntaxOnly: args["syntax-only"] === true,
    };
  } else if (command === "check") {
    const css = args["css-text"] ?? (args.css ? fs.readFileSync(path.resolve(args.css), "utf8") : null);
    const wikitext =
      args["wikitext-text"] ?? (args.wikitext ? fs.readFileSync(path.resolve(args.wikitext), "utf8") : null);
    const siteId = args["site-id"] !== undefined ? parseSiteId(args["site-id"]) : null;
    const surfaceContract = args.iteration === true
      ? null
      : readSurfaceContract(
          args["surface-contract"] ?? (siteId !== null && typeof css === "string" ? "auto" : null),
        );
    request = {
      op: "check",
      css,
      baseCss: args["css-base"] ? fs.readFileSync(path.resolve(args["css-base"]), "utf8") : "",
      sourceStructure: args["source-structure"] ? await loadCandidateStructure(path.dirname(path.resolve(args["source-structure"]))) : null,
      wikitext,
      savedCandidate: args["saved-candidate"] === true,
      source: args.source ? fs.readFileSync(path.resolve(args.source), "utf8") : null,
      pageAssets: args["page-assets"] ? JSON.parse(fs.readFileSync(path.resolve(args["page-assets"]), "utf8")).assets ?? [] : [],
      title: args.title ?? "Preview",
      syntaxOnly: args["syntax-only"] === true,
      iteration: args.iteration === true,
      referenceUrl: args.reference ?? args["reference-url"] ?? null,
      referenceOffline: args.offline === true,
      selectors: args.selectors ? readSelectors(args.selectors) : null,
      siteId,
      torture: args["no-torture"] !== true && siteId !== null,
      viewports: args["no-viewports"] !== true,
      visual: args.visual === true,
      visualReview: args["visual-review"] ? JSON.parse(fs.readFileSync(path.resolve(args["visual-review"]), "utf8")) : null,
      artifactDir: args["artifact-dir"] ? path.resolve(args["artifact-dir"]) : null,
      surfaceContract,
      verbose: args.verbose === true || args["json-full"] === true,
    };
  } else if (command === "reference") {
    if (!args.url) throw new ThemeLabError("invalid_reference_url", "reference requires --url");
    request = {op: "reference_load", url: args.url, offline: args.offline === true};
  } else if (command === "viewport") {
    const viewport = parseViewport(args.size ?? args.viewport);
    request = {op: "viewport", target: args.target ?? "candidate", ...viewport};
  } else if (command === "snapshot") {
    request = {
      op: "snapshot",
      target: args.target ?? "candidate",
      selectors: args.selectors ? readSelectors(args.selectors) : null,
    };
  } else if (command === "probe") {
    request = {
      op: "probe",
      target: args.target ?? "candidate",
      selector: args.selector,
      property: args.property,
      viewport: parseViewport(args.viewport),
    };
  } else if (command === "diff") {
    request = {
      op: "diff",
      referenceUrl: args["reference-url"],
      selectors: args.selectors ? readSelectors(args.selectors) : null,
    };
  } else if (command === "screenshot") {
    request = {
      op: "screenshot",
      target: args.target ?? "candidate",
      path: path.resolve(args.path),
      fullPage: args["no-full-page"] !== true,
      viewport: parseViewport(args.viewport),
    };
  } else if (command === "status") {
    request = {op: "status"};
  } else {
    process.stderr.write(`unknown command: ${command}\n`);
    return 2;
  }

  const response = await sendRequest(socketPath, request);
  if (command === "check" && response.ok) {
    const status=response.result?.overall_acceptance?.status ?? "inconclusive";
    response.verdict=status;
    response.overall_acceptance=response.result?.overall_acceptance ?? {status};
    process.stdout.write(`${JSON.stringify(response, null, args.compact ? 0 : 2)}\n`);
    return status === "fail" ? 1 : ["pass", "warn"].includes(status) ? 0 : 2;
  }
  process.stdout.write(`${JSON.stringify(response, null, args.compact ? 0 : 2)}\n`);
  return response.ok ? 0 : 1;
}

function parseViewport(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d+)x(\d+)$/u);
  if (!match) throw new ThemeLabError("invalid_viewport", `viewport must be WIDTHxHEIGHT, got ${value}`);
  return {width: Number.parseInt(match[1], 10), height: Number.parseInt(match[2], 10)};
}

function parseSiteId(value) {
  const siteId = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(siteId)) {
    throw new ThemeLabError("invalid_site_id", "--site-id must be an integer site id, e.g. 6000003");
  }
  return siteId;
}

main().then(
  (code) => process.exit(code ?? 0),
  (error) => {
    const payload =
      error instanceof ThemeLabError
        ? {ok: false, error: error.toJSON()}
        : {ok: false, error: {code: "internal_error", message: String(error?.message ?? error)}};
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(1);
  },
);
