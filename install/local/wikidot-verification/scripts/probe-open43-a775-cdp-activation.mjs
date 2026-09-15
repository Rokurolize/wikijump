#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CONTROL_SELECTOR = "a.wiki-standalone-button";
const SAMPLE_DELAYS_MS = [0, 25, 50, 100, 200, 500, 1000, 2000, 3000];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") args.profile = argv[++index];
    else if (arg === "--url") args.url = argv[++index];
    else if (arg === "--output") args.output = path.resolve(argv[++index]);
    else if (arg === "--mode") args.mode = argv[++index];
    else if (arg === "--help") args.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.help) return args;
  if (!args.profile || !args.url || !args.output || !["click", "keyboard", "double", "history"].includes(args.mode)) throw new Error("--profile, --url, --output, and --mode click|keyboard|double|history are required");
  return args;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timestamp() {
  return {wall_ms: Date.now(), monotonic_ms: Number(process.hrtime.bigint() / 1000000n)};
}

function endpointFromProfile(profile) {
  const lines = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/u);
  if (lines.length < 2) throw new Error("DevToolsActivePort is incomplete");
  return {profile, browserWs: `ws://127.0.0.1:${lines[0]}${lines[1]}`};
}

class Cdp {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async connect() {
    this.ws = new WebSocket(this.endpoint.browserWs);
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) {
        for (const listener of this.listeners) listener(message);
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result ?? {});
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connection timed out")), 10000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, {once: true});
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket error")); }, {once: true});
    });
  }

  call(method, params = {}, sessionId = null, timeoutMs = 10000) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify(sessionId ? {id, method, params, sessionId} : {id, method, params}));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {timer, resolve, reject});
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

function evaluateExpression() {
  return `(() => {
    const visible = (element) => { if (!element) return false; const style = getComputedStyle(element); return style.display !== "none" && style.visibility !== "hidden" && (element.offsetWidth || element.offsetHeight || element.getClientRects().length) > 0; };
    const describe = (element) => element ? {tag: element.localName || null, id: element.id || null, class: String(element.className || "").slice(0, 180), text: ["body", "html"].includes(element.localName) ? null : String(element.textContent || "").trim().slice(0, 500)} : null;
    const control = document.querySelector(${JSON.stringify(CONTROL_SELECTOR)});
    const dialog = document.querySelector("#odialog-container");
    const editor = [...document.querySelectorAll("#editor, #edit-page-textarea, textarea[name=source]")].find(visible) || null;
    const active = document.activeElement;
    return {
      wall_ms: Date.now(),
      performance_ms: Math.round(performance.now() * 1000) / 1000,
      href: location.href,
      path: location.pathname,
      ready_state: document.readyState,
      body_class: String(document.body?.className || ""),
      history_length: history.length,
      active: describe(active),
      active_is_control: active === control,
      control: control ? {count: document.querySelectorAll(${JSON.stringify(CONTROL_SELECTOR)}).length, text: String(control.textContent || ""), href: control.getAttribute("href"), class: control.getAttribute("class"), onclick_present: control.hasAttribute("onclick"), outer: control.outerHTML.slice(0, 600)} : {count: document.querySelectorAll(${JSON.stringify(CONTROL_SELECTOR)}).length},
      editor: editor ? {id: editor.id || null, name: editor.getAttribute("name"), visible: visible(editor), value_length: typeof editor.value === "string" ? editor.value.length : null, focused: active === editor} : null,
      dialog: dialog && visible(dialog) ? {visible: true, text: String(dialog.innerText || dialog.textContent || "").trim().slice(0, 700)} : {visible: false},
      loading: !!(document.body?.classList.contains("wait") || document.body?.classList.contains("loading")),
      source_disclosure: (document.body?.innerText || "").includes("[[button edit]]"),
    };
  })()`;
}

function valueFromRuntime(result) {
  if (result?.result?.type === "undefined") return undefined;
  if (Object.prototype.hasOwnProperty.call(result?.result ?? {}, "value")) return result.result.value;
  return result?.result?.unserializableValue ?? result?.result;
}

async function evaluate(cdp, sessionId, expression, awaitPromise = true) {
  const result = await cdp.call("Runtime.evaluate", {expression, awaitPromise, returnByValue: true, userGesture: true}, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "Runtime.evaluate failed");
  return valueFromRuntime(result);
}

async function pageTarget(cdp) {
  const targets = await cdp.call("Target.getTargets");
  const pages = targets.targetInfos.filter((target) => target.type === "page");
  const page = pages.find((target) => target.url.startsWith("http://sandbox-for-codex.wikidot.com/")) ?? pages.find((target) => target.url !== "about:blank") ?? pages[0];
  if (!page) throw new Error("no page target");
  const attached = await cdp.call("Target.attachToTarget", {targetId: page.targetId, flatten: true});
  return {page, sessionId: attached.sessionId};
}

function requestFields(postData) {
  if (!postData) return null;
  const keys = [];
  for (const key of new URLSearchParams(postData).keys()) if (!keys.includes(key)) keys.push(key);
  return {encoding: keys.length > 0 ? "form" : "opaque", keys: keys.sort(), bytes: Buffer.byteLength(postData)};
}

function networkRecorder(cdp, sessionId, origin, operation) {
  const rows = new Map();
  const listener = (message) => {
    if (message.sessionId !== sessionId) return;
    const params = message.params ?? {};
    if (message.method === "Network.requestWillBeSent") {
      const url = new URL(params.request.url);
      if (url.origin !== origin || !["Document", "XHR", "Fetch"].includes(params.type)) return;
      const row = {request_id: params.requestId, phase: operation.phase, timestamp: params.timestamp ?? null, wall_time: params.wallTime ?? null, method: params.request.method, path: `${url.pathname}${url.search}`, resource_type: params.type, post_data_sha256: params.request.postData ? hash(params.request.postData) : null, post_data: requestFields(params.request.postData)};
      rows.set(params.requestId, row);
      operation.network.push({request: row});
    } else if (message.method === "Network.responseReceived") {
      const row = rows.get(params.requestId);
      if (!row) return;
      row.response = {timestamp: params.timestamp ?? null, status: params.response.status, mime_type: params.response.mimeType ?? null, from_disk_cache: !!params.response.fromDiskCache, from_service_worker: !!params.response.fromServiceWorker, encoded_data_length: params.response.encodedDataLength ?? null};
      operation.network.push({response: {request_id: params.requestId, phase: row.phase, ...row.response}});
    }
  };
  cdp.listeners.add(listener);
  return {rows, stop: () => cdp.listeners.delete(listener)};
}

async function state(cdp, sessionId, operation, label) {
  const mark = timestamp();
  try {
    operation.timeline.push({label, ...mark, state: await evaluate(cdp, sessionId, evaluateExpression())});
  } catch (error) {
    operation.timeline.push({label, ...mark, evaluation_error: String(error.message || error)});
  }
}

async function controlPoint(cdp, sessionId) {
  return evaluate(cdp, sessionId, `(() => { const element = document.querySelector(${JSON.stringify(CONTROL_SELECTOR)}); if (!element) throw new Error("standalone edit control missing"); const rect = element.getBoundingClientRect(); return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}; })()`);
}

async function clickAt(cdp, sessionId, count = 1) {
  const point = await controlPoint(cdp, sessionId);
  await cdp.call("Input.dispatchMouseEvent", {type: "mouseMoved", x: point.x, y: point.y}, sessionId);
  await cdp.call("Input.dispatchMouseEvent", {type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: count}, sessionId);
  await cdp.call("Input.dispatchMouseEvent", {type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: count}, sessionId);
}

async function focusControl(cdp, sessionId) {
  return evaluate(cdp, sessionId, `(() => { const element = document.querySelector(${JSON.stringify(CONTROL_SELECTOR)}); if (!element) throw new Error("standalone edit control missing"); element.focus(); return document.activeElement === element; })()`);
}

async function keyboardEnter(cdp, sessionId) {
  await cdp.call("Input.dispatchKeyEvent", {type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13}, sessionId);
  await cdp.call("Input.dispatchKeyEvent", {type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13}, sessionId);
}

async function history(cdp, sessionId, operation) {
  operation.history_before_back = await cdp.call("Page.getNavigationHistory", {}, sessionId).catch((error) => ({error: String(error.message || error)}));
  operation.phase = "history-back";
  await evaluate(cdp, sessionId, "history.back()", false).catch(() => undefined);
  await sleep(1000);
  operation.history_back = await cdp.call("Page.getNavigationHistory", {}, sessionId).catch((error) => ({error: String(error.message || error)}));
  await state(cdp, sessionId, operation, "history-after-back");
  operation.phase = "history-forward";
  await evaluate(cdp, sessionId, "history.forward()", false).catch(() => undefined);
  await sleep(1000);
  operation.history_forward = await cdp.call("Page.getNavigationHistory", {}, sessionId).catch((error) => ({error: String(error.message || error)}));
  await state(cdp, sessionId, operation, "history-after-forward");
}

async function saveOneResponse(cdp, sessionId, recorder, operation, outputDir) {
  fs.mkdirSync(path.join(outputDir, "responses"), {recursive: true});
  for (const row of recorder.rows.values()) {
    if (operation.phase !== "activation" || row.resource_type !== "XHR" || row.path !== "/ajax-module-connector.php") continue;
    try {
      const body = await cdp.call("Network.getResponseBody", {requestId: row.request_id}, sessionId, 5000);
      const bytes = body.base64Encoded ? Buffer.from(body.body, "base64") : Buffer.from(body.body, "utf8");
      const bodyPath = path.join(outputDir, `response-${operation.mode}-${row.request_id.replace(/[^A-Za-z0-9_-]/gu, "_")}.body`);
      fs.writeFileSync(bodyPath, bytes);
      row.response_body_path = bodyPath;
      row.response_body_bytes = bytes.length;
      row.response_body_sha256 = hash(bytes);
    } catch (error) {
      row.response_body_error = String(error.message || error).slice(0, 300);
    }
  }
}

async function cleanup(cdp, sessionId, operation) {
  const editor = await evaluate(cdp, sessionId, "!!document.querySelector('#edit-page-textarea')").catch(() => false);
  if (editor) {
    operation.cleanup = "editor_cancel";
    await evaluate(cdp, sessionId, "document.querySelector('#edit-cancel-button')?.click()", false).catch(() => undefined);
    await sleep(1000);
    await state(cdp, sessionId, operation, "after-editor-cancel");
  } else {
    const dialog = await evaluate(cdp, sessionId, "!!document.querySelector('#odialog-container') && !!(document.querySelector('#odialog-container').offsetWidth || document.querySelector('#odialog-container').offsetHeight)").catch(() => false);
    if (dialog) {
      operation.cleanup = "dialog_close";
      await evaluate(cdp, sessionId, "document.querySelector('#odialog-container .button-close-message, .button-close-message')?.click()", false).catch(() => undefined);
      await sleep(1000);
      await state(cdp, sessionId, operation, "after-dialog-close");
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("probe-open43-a775-cdp-activation.mjs --profile DIR --url URL --output FILE --mode click|keyboard|double|history\n");
    return;
  }
  const endpoint = endpointFromProfile(args.profile);
  const cdp = new Cdp(endpoint);
  await cdp.connect();
  try {
    const versions = await cdp.call("Browser.getVersion");
    const {page, sessionId} = await pageTarget(cdp);
    await cdp.call("Runtime.enable", {}, sessionId);
    await cdp.call("Network.enable", {}, sessionId);
    await cdp.call("Page.enable", {}, sessionId);
    await cdp.call("Emulation.setDeviceMetricsOverride", {width: 1280, height: 900, deviceScaleFactor: 1, mobile: false}, sessionId);
    const operation = {schema: "wikijump.open43.a775_cdp_activation.v1", captured_at: new Date().toISOString(), mode: args.mode, page_url: args.url, selector: CONTROL_SELECTOR, phase: "initial", browser: {profile: args.profile, target_id: page.targetId, version: versions}, timeline: [], network: []};
    const recorder = networkRecorder(cdp, sessionId, new URL(args.url).origin, operation);
    try {
      await state(cdp, sessionId, operation, "initial");
      operation.phase = "activation";
      if (args.mode === "keyboard") {
        await focusControl(cdp, sessionId);
        await state(cdp, sessionId, operation, "focus-before-keyboard");
        await keyboardEnter(cdp, sessionId);
      } else if (args.mode === "double") {
        await focusControl(cdp, sessionId);
        await state(cdp, sessionId, operation, "focus-before-double");
        await clickAt(cdp, sessionId, 1);
        await clickAt(cdp, sessionId, 2);
      } else if (args.mode === "click") {
        await clickAt(cdp, sessionId, 1);
      } else {
        await clickAt(cdp, sessionId, 1);
      }
      operation.dispatched = timestamp();
      await state(cdp, sessionId, operation, "after-dispatch");
      let previous = 0;
      for (const delay of SAMPLE_DELAYS_MS) {
        if (delay > previous) await sleep(delay - previous);
        previous = delay;
        await state(cdp, sessionId, operation, `sample-${delay}ms`);
      }
      if (args.mode === "history") await history(cdp, sessionId, operation);
      await saveOneResponse(cdp, sessionId, recorder, operation, path.dirname(args.output));
      await cleanup(cdp, sessionId, operation);
    } finally {
      recorder.stop();
    }
    operation.phase = "complete";
    fs.mkdirSync(path.dirname(args.output), {recursive: true});
    fs.writeFileSync(args.output, `${JSON.stringify(operation, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ok: true, output: args.output, mode: args.mode})}\n`);
  } finally {
    cdp.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ok: false, error: String(error.message || error)})}\n`);
  process.exitCode = 1;
});
