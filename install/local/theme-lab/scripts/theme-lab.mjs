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
import net from "node:net";
import path from "node:path";
import process from "node:process";

import {loadChromium} from "../src/browser-lab.mjs";
import {stopDaemon} from "../src/daemon.mjs";
import {createDeepwellPreviewClient} from "../src/deepwell-preview.mjs";
import {ThemeLabError} from "../src/errors.mjs";
import {ReferenceCache, defaultCacheDir} from "../src/reference-cache.mjs";
import {startSessionServer} from "../src/session-server.mjs";

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

function sendRequest(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    let buffer = "";
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      socket.end();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
    socket.on("error", (error) => {
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

async function serve(args) {
  const socketPath = path.resolve(args.socket ?? "/tmp/theme-lab.sock");
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
      "commands: serve | open | check | css | clear-css | preview | torture | reference | viewport | snapshot | diff | screenshot | status | stop\n",
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
    request = {
      op: "check",
      css,
      wikitext,
      title: args.title ?? "Preview",
      syntaxOnly: args["syntax-only"] === true,
      referenceUrl: args.reference ?? args["reference-url"] ?? null,
      referenceOffline: args.offline === true,
      selectors: args.selectors ? readSelectors(args.selectors) : null,
      siteId,
      torture: args["no-torture"] !== true && siteId !== null,
      viewports: args["no-viewports"] !== true,
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
