#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const PUBLIC_URL = "https://www.wikidot.com/doc-wiki-syntax:buttons";
const PRINT_SELECTOR = 'a.wiki-standalone-button[onclick*="printClick"]';
const VIEWPORT = Object.freeze({width: 1280, height: 900, device_scale_factor: 1});
const DEFAULT_OUTPUT = path.resolve(
  "install/local/wikidot-verification/artifacts/open43-issue777-exact-live-print-transitions-20260915",
);
const CHROME_EXECUTABLE = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe";
const CAPTURE_SCRIPT = path.resolve(fileURLToPath(import.meta.url));
const TEST_SCRIPT = path.resolve(
  path.dirname(CAPTURE_SCRIPT),
  "test-open43-issue777-live-print.mjs",
);

const INIT_SCRIPT = String.raw`(() => {
  const PRINT_SELECTOR = 'a.wiki-standalone-button[onclick*="printClick"]';
  const state = {
    schema: "wikidot.open43_issue777_live_print_probe.v1",
    timeline: [],
    printCalls: [],
    openCalls: [],
    actions: [],
    currentAction: null,
    mutationCount: 0,
    nativePrintDescriptor: null,
  };

  function now() {
    return Number(performance.now().toFixed(3));
  }

  function trim(value, limit = 240) {
    return String(value ?? "").replace(/\\s+/g, " ").trim().slice(0, limit);
  }

  function describe(element) {
    if (!element) return null;
    const attrs = {};
    for (const name of ["id", "class", "href", "onclick", "style", "aria-busy", "tabindex", "role"]) {
      const value = element.getAttribute(name);
      if (value !== null) attrs[name] = value;
    }
    return {
      tag: element.tagName.toLowerCase(),
      text: element === document.body ? null : trim(element.textContent, 120),
      attrs,
      outer_html: element === document.body ? element.outerHTML.slice(0, 400) : element.outerHTML.slice(0, 2400),
    };
  }

  function relatedToControl(element) {
    const control = document.querySelector(PRINT_SELECTOR);
    if (!element || !control) return false;
    return element === control ||
      element === control.parentElement ||
      element === control.parentElement?.parentElement ||
      control.contains(element) ||
      element.contains?.(control);
  }

  function mutationRelatedToControl(element) {
    const control = document.querySelector(PRINT_SELECTOR);
    if (!element || !control) return false;
    return element === control || element === control.parentElement || element === control.parentElement?.parentElement;
  }

  function activeElement() {
    return describe(document.activeElement);
  }

  function record(kind, details = {}) {
    const event = {
      sequence: state.timeline.length + 1,
      kind,
      performance_ms: now(),
      epoch_ms: Date.now(),
      ...details,
    };
    state.timeline.push(event);
    if (state.currentAction) state.currentAction.timeline.push(event);
    return event;
  }

  function styleState(element) {
    if (!element) return null;
    const style = getComputedStyle(element);
    return {
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      pointer_events: style.pointerEvents,
      cursor: style.cursor,
      outline_style: style.outlineStyle,
      outline_width: style.outlineWidth,
    };
  }

  function domSnapshot(label) {
    const control = document.querySelector(PRINT_SELECTOR);
    const parent = control?.parentElement ?? null;
    const previous = control?.previousElementSibling ?? null;
    const next = control?.nextElementSibling ?? null;
    const action = state.currentAction;
    const snapshot = {
      label,
      performance_ms: now(),
      epoch_ms: Date.now(),
      url: location.href,
      pathname: location.pathname,
      title: document.title,
      ready_state: document.readyState,
      visibility_state: document.visibilityState,
      document_has_focus: document.hasFocus(),
      active_element: activeElement(),
      scroll_x: Number(window.scrollX.toFixed(3)),
      scroll_y: Number(window.scrollY.toFixed(3)),
      history_length: history.length,
      media_print_matches: window.matchMedia("print").matches,
      print_control: {
        count: document.querySelectorAll(PRINT_SELECTOR).length,
        rendered: control ? getComputedStyle(control).display !== "none" && getComputedStyle(control).visibility !== "hidden" : false,
        focused: document.activeElement === control,
        aria_busy: control?.getAttribute("aria-busy") ?? null,
        tab_index: control?.tabIndex ?? null,
        bounding_rect: control ? (() => {
          const rect = control.getBoundingClientRect();
          return {
            x: Number(rect.x.toFixed(3)),
            y: Number(rect.y.toFixed(3)),
            width: Number(rect.width.toFixed(3)),
            height: Number(rect.height.toFixed(3)),
          };
        })() : null,
        computed_style: styleState(control),
        element: describe(control),
      },
      adjacent_dom: {
        parent_outer_html: parent?.outerHTML.slice(0, 4000) ?? null,
        previous_sibling_outer_html: previous?.outerHTML.slice(0, 1600) ?? null,
        next_sibling_outer_html: next?.outerHTML.slice(0, 1600) ?? null,
      },
      print_call_count: state.printCalls.length,
      open_call_count: state.openCalls.length,
      action_print_call_count: action?.printCalls.length ?? 0,
      action_open_call_count: action?.openCalls.length ?? 0,
      mutation_count: state.mutationCount,
    };
    record("dom.snapshot", {label, focused: snapshot.print_control.focused, print_call_count: snapshot.print_call_count});
    if (action) action.snapshots.push(snapshot);
    return snapshot;
  }

  state.beginAction = (label) => {
    const action = {
      label,
      started_performance_ms: now(),
      started_epoch_ms: Date.now(),
      timeline: [],
      snapshots: [],
      printCalls: [],
      openCalls: [],
    };
    state.actions.push(action);
    state.currentAction = action;
    record("action.begin", {label});
    return {label, started_performance_ms: action.started_performance_ms};
  };

  state.snapshot = domSnapshot;
  state.finishAction = () => {
    if (!state.currentAction) return null;
    state.currentAction.finished_performance_ms = now();
    state.currentAction.finished_epoch_ms = Date.now();
    const result = state.currentAction;
    record("action.end", {label: result.label});
    state.currentAction = null;
    return result;
  };

  state.getSummary = () => ({
    schema: state.schema,
    native_print_descriptor: state.nativePrintDescriptor,
    timeline: state.timeline,
    print_calls: state.printCalls,
    actions: state.actions,
    mutation_count: state.mutationCount,
  });

  Object.defineProperty(window, "__open43Issue777LivePrint", {
    configurable: false,
    enumerable: false,
    value: state,
  });

  const nativePrint = typeof window.print === "function" ? window.print : null;
  const nativeOpen = typeof window.open === "function" ? window.open : null;
  const descriptor = Object.getOwnPropertyDescriptor(window, "print");
  state.nativePrintDescriptor = {
    callable: nativePrint !== null,
    own_property: descriptor !== undefined,
    configurable: descriptor?.configurable ?? null,
    native_string_prefix: nativePrint ? String(nativePrint).slice(0, 160) : null,
  };
  Object.defineProperty(window, "print", {
    configurable: true,
    enumerable: descriptor?.enumerable ?? true,
    writable: true,
    value: function instrumentedPrint(...args) {
      const control = document.querySelector(PRINT_SELECTOR);
      const call = {
        ordinal: state.printCalls.length + 1,
        before_performance_ms: now(),
        before_epoch_ms: Date.now(),
        url: location.href,
        history_length: history.length,
        focused_control: document.activeElement === control,
        active_element: activeElement(),
        argument_count: args.length,
      };
      state.printCalls.push(call);
      if (state.currentAction) state.currentAction.printCalls.push(call);
      record("window.print.before", {
        ordinal: call.ordinal,
        url: call.url,
        history_length: call.history_length,
        focused_control: call.focused_control,
        active_element: call.active_element,
      });
      if (!nativePrint) {
        call.return_type = "unavailable";
        record("window.print.unavailable", {ordinal: call.ordinal});
        return undefined;
      }
      try {
        const result = nativePrint.apply(window, args);
        call.return_type = typeof result;
        call.after_performance_ms = now();
        call.after_epoch_ms = Date.now();
        call.returned = result === undefined ? "undefined" : trim(result, 80);
        record("window.print.return", {
          ordinal: call.ordinal,
          return_type: call.return_type,
          elapsed_ms: Number((call.after_performance_ms - call.before_performance_ms).toFixed(3)),
        });
        return result;
      } catch (error) {
        call.error = trim(error?.name + ": " + error?.message, 240);
        call.after_performance_ms = now();
        record("window.print.error", {ordinal: call.ordinal, error: call.error});
        throw error;
      }
    },
  });

  Object.defineProperty(window, "open", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function instrumentedOpen(...args) {
      const requestedUrl = args[0] === undefined || args[0] === "" ? null : String(args[0]);
      const call = {
        ordinal: state.openCalls.length + 1,
        performance_ms: now(),
        epoch_ms: Date.now(),
        requested_url: requestedUrl,
        target_name: args[1] === undefined ? null : String(args[1]),
        feature_string_present: args[2] !== undefined && args[2] !== "",
      };
      state.openCalls.push(call);
      if (state.currentAction) state.currentAction.openCalls.push(call);
      record("window.open.before", {
        ordinal: call.ordinal,
        requested_url: call.requested_url,
        target_name: call.target_name,
        feature_string_present: call.feature_string_present,
      });
      if (!nativeOpen) {
        call.returned_window = false;
        record("window.open.unavailable", {ordinal: call.ordinal});
        return null;
      }
      const result = nativeOpen.apply(window, args);
      call.returned_window = result !== null;
      record("window.open.return", {ordinal: call.ordinal, returned_window: call.returned_window});
      return result;
    },
  });

  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "keydown", "keyup", "keypress", "focusin", "focusout"]) {
    document.addEventListener(type, (event) => {
      if (!relatedToControl(event.target)) return;
      record("dom.event", {
        event_type: type,
        listener_phase: "capture",
        target: describe(event.target),
        related_target: describe(event.relatedTarget),
        default_prevented: event.defaultPrevented,
        cancelable: event.cancelable,
        key: event.key ?? null,
        code: event.code ?? null,
        repeat: event.repeat ?? false,
        is_trusted: event.isTrusted,
      });
    }, true);
    document.addEventListener(type, (event) => {
      if (!relatedToControl(event.target)) return;
      record("dom.event", {
        event_type: type,
        listener_phase: "bubble",
        target: describe(event.target),
        related_target: describe(event.relatedTarget),
        default_prevented: event.defaultPrevented,
        cancelable: event.cancelable,
        key: event.key ?? null,
        code: event.code ?? null,
        repeat: event.repeat ?? false,
        is_trusted: event.isTrusted,
      });
    }, false);
  }

  for (const type of ["beforeprint", "afterprint", "focus", "blur", "pageshow", "pagehide", "popstate", "hashchange"]) {
    window.addEventListener(type, (event) => {
      record("window.event", {
        event_type: type,
        target: describe(event.target),
        persisted: event.persisted ?? null,
        url: location.href,
        history_length: history.length,
        active_element: activeElement(),
        media_print_matches: window.matchMedia("print").matches,
      });
    });
  }
  document.addEventListener("visibilitychange", () => {
    record("document.event", {
      event_type: "visibilitychange",
      visibility_state: document.visibilityState,
      active_element: activeElement(),
    });
  });
  try {
    const media = window.matchMedia("print");
    media.addEventListener("change", (event) => {
      record("media.event", {media: "print", matches: event.matches});
    });
  } catch (error) {
    record("media.event.error", {error: trim(error?.message, 160)});
  }

  for (const method of ["pushState", "replaceState", "back", "forward", "go"]) {
    try {
      const original = history[method];
      if (typeof original !== "function") continue;
      history[method] = function instrumentedHistoryMethod(...args) {
        record("history.method", {method, argument_count: args.length, url: location.href, history_length: history.length});
        return original.apply(this, args);
      };
    } catch (error) {
      record("history.method.error", {method, error: trim(error?.message, 160)});
    }
  }

  function installMutationObserver() {
    if (!document.documentElement) return;
    const observer = new MutationObserver((records) => {
      for (const mutation of records) {
        if (!mutationRelatedToControl(mutation.target)) continue;
        state.mutationCount += 1;
        if (state.mutationCount <= 100) {
          record("dom.mutation", {
            mutation_type: mutation.type,
            target: describe(mutation.target),
            attribute_name: mutation.attributeName ?? null,
            old_value: mutation.oldValue ?? null,
            added_nodes: mutation.addedNodes?.length ?? 0,
            removed_nodes: mutation.removedNodes?.length ?? 0,
          });
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installMutationObserver, {once: true});
  else installMutationObserver();
})();`;

const CHILD_INIT_SCRIPT = String.raw`(() => {
  const PRINT_SELECTOR = 'a[href="javascript:;"][onclick*="window.print"]';
  const state = {
    schema: "wikidot.open43_issue777_child_print_probe.v1",
    timeline: [],
    printCalls: [],
    currentAction: null,
    mutationCount: 0,
  };

  function now() {
    return Number(performance.now().toFixed(3));
  }

  function trim(value, limit = 240) {
    return String(value ?? "").replace(/\\s+/g, " ").trim().slice(0, limit);
  }

  function describe(element) {
    if (!element) return null;
    const attrs = {};
    for (const name of ["id", "class", "href", "onclick", "style", "aria-busy", "tabindex", "role"]) {
      const value = element.getAttribute(name);
      if (value !== null) attrs[name] = value;
    }
    return {
      tag: element.tagName.toLowerCase(),
      text: element === document.body ? null : trim(element.textContent, 120),
      attrs,
      outer_html: element === document.body ? element.outerHTML.slice(0, 400) : element.outerHTML.slice(0, 2400),
    };
  }

  function related(element) {
    const control = document.querySelector(PRINT_SELECTOR);
    return Boolean(element && control && (element === control || element === control.parentElement || element === control.parentElement?.parentElement));
  }

  function record(kind, details = {}) {
    const event = {sequence: state.timeline.length + 1, kind, performance_ms: now(), epoch_ms: Date.now(), ...details};
    state.timeline.push(event);
    if (state.currentAction) state.currentAction.timeline.push(event);
    return event;
  }

  function snapshot(label) {
    const control = document.querySelector(PRINT_SELECTOR);
    const parent = control?.parentElement ?? null;
    const snapshotValue = {
      label,
      performance_ms: now(),
      epoch_ms: Date.now(),
      url: location.href,
      pathname: location.pathname,
      title: document.title,
      ready_state: document.readyState,
      visibility_state: document.visibilityState,
      document_has_focus: document.hasFocus(),
      active_element: describe(document.activeElement),
      history_length: history.length,
      media_print_matches: window.matchMedia("print").matches,
      print_control: {
        count: document.querySelectorAll(PRINT_SELECTOR).length,
        rendered: control ? getComputedStyle(control).display !== "none" && getComputedStyle(control).visibility !== "hidden" : false,
        focused: document.activeElement === control,
        aria_busy: control?.getAttribute("aria-busy") ?? null,
        bounding_rect: control ? (() => {
          const rect = control.getBoundingClientRect();
          return {x: Number(rect.x.toFixed(3)), y: Number(rect.y.toFixed(3)), width: Number(rect.width.toFixed(3)), height: Number(rect.height.toFixed(3))};
        })() : null,
        element: describe(control),
      },
      adjacent_dom: {parent_outer_html: parent?.outerHTML.slice(0, 4000) ?? null},
      print_call_count: state.printCalls.length,
      mutation_count: state.mutationCount,
    };
    record("dom.snapshot", {label, focused: snapshotValue.print_control.focused, print_call_count: snapshotValue.print_call_count});
    if (state.currentAction) state.currentAction.snapshots.push(snapshotValue);
    return snapshotValue;
  }

  state.snapshot = snapshot;
  state.beginAction = (label) => {
    const action = {label, started_performance_ms: now(), started_epoch_ms: Date.now(), timeline: [], snapshots: [], printCalls: []};
    state.currentAction = action;
    record("action.begin", {label});
    return {label, started_performance_ms: action.started_performance_ms};
  };
  state.finishAction = () => {
    if (!state.currentAction) return null;
    state.currentAction.finished_performance_ms = now();
    state.currentAction.finished_epoch_ms = Date.now();
    const result = state.currentAction;
    record("action.end", {label: result.label});
    state.currentAction = null;
    return result;
  };

  Object.defineProperty(window, "__open43Issue777ChildPrint", {configurable: false, enumerable: false, value: state});
  const nativePrint = typeof window.print === "function" ? window.print : null;
  Object.defineProperty(window, "print", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: function instrumentedChildPrint(...args) {
      const control = document.querySelector(PRINT_SELECTOR);
      const call = {
        ordinal: state.printCalls.length + 1,
        before_performance_ms: now(),
        before_epoch_ms: Date.now(),
        url: location.href,
        history_length: history.length,
        focused_control: document.activeElement === control,
        active_element: describe(document.activeElement),
        argument_count: args.length,
      };
      state.printCalls.push(call);
      if (state.currentAction) state.currentAction.printCalls.push(call);
      record("window.print.before", {ordinal: call.ordinal, url: call.url, history_length: call.history_length, focused_control: call.focused_control, active_element: call.active_element});
      if (!nativePrint) {
        call.return_type = "unavailable";
        record("window.print.unavailable", {ordinal: call.ordinal});
        return undefined;
      }
      try {
        const result = nativePrint.apply(window, args);
        call.return_type = typeof result;
        call.after_performance_ms = now();
        call.after_epoch_ms = Date.now();
        record("window.print.return", {ordinal: call.ordinal, return_type: call.return_type, elapsed_ms: Number((call.after_performance_ms - call.before_performance_ms).toFixed(3))});
        return result;
      } catch (error) {
        call.error = trim(error?.name + ": " + error?.message, 240);
        call.after_performance_ms = now();
        record("window.print.error", {ordinal: call.ordinal, error: call.error});
        throw error;
      }
    },
  });
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "keydown", "keyup", "keypress", "focusin", "focusout"]) {
    document.addEventListener(type, (event) => {
      if (!related(event.target)) return;
      record("dom.event", {event_type: type, listener_phase: "capture", default_prevented: event.defaultPrevented, key: event.key ?? null, code: event.code ?? null, is_trusted: event.isTrusted});
    }, true);
    document.addEventListener(type, (event) => {
      if (!related(event.target)) return;
      record("dom.event", {event_type: type, listener_phase: "bubble", default_prevented: event.defaultPrevented, key: event.key ?? null, code: event.code ?? null, is_trusted: event.isTrusted});
    }, false);
  }
  for (const type of ["beforeprint", "afterprint", "focus", "blur", "pageshow", "pagehide", "popstate", "hashchange"]) {
    window.addEventListener(type, (event) => {
      record("window.event", {event_type: type, url: location.href, history_length: history.length, active_element: describe(document.activeElement), media_print_matches: window.matchMedia("print").matches, persisted: event.persisted ?? null});
    });
  }
  document.addEventListener("visibilitychange", () => record("document.event", {event_type: "visibilitychange", visibility_state: document.visibilityState, active_element: describe(document.activeElement)}));
  try {
    const media = window.matchMedia("print");
    media.addEventListener("change", (event) => record("media.event", {media: "print", matches: event.matches}));
  } catch (error) {
    record("media.event.error", {error: trim(error?.message, 160)});
  }
  const observer = new MutationObserver((records) => {
    for (const mutation of records) {
      if (!related(mutation.target)) continue;
      state.mutationCount += 1;
      if (state.mutationCount <= 50) record("dom.mutation", {mutation_type: mutation.type, attribute_name: mutation.attributeName ?? null, old_value: mutation.oldValue ?? null, added_nodes: mutation.addedNodes?.length ?? 0, removed_nodes: mutation.removedNodes?.length ?? 0});
    }
  });
  if (document.documentElement) observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true, attributeOldValue: true});
})();`;

function parseArgs(argv) {
  const args = {
    profile: process.env.CHROME_USER_DATA_DIR,
    output: DEFAULT_OUTPUT,
    url: PUBLIC_URL,
    mode: "capture",
    stop_exit_code: null,
    remove_exit_code: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--profile") args.profile = argv[++index];
    else if (arg === "--output") args.output = path.resolve(argv[++index]);
    else if (arg === "--url") args.url = argv[++index];
    else if (arg === "--finalize") args.mode = "finalize";
    else if (arg === "--stop-exit-code") args.stop_exit_code = Number(argv[++index]);
    else if (arg === "--remove-exit-code") args.remove_exit_code = Number(argv[++index]);
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write("Usage: capture-open43-issue777-live-print.mjs --profile DIR --output DIR [--finalize --stop-exit-code N --remove-exit-code N]\n");
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.profile) throw new Error("--profile or CHROME_USER_DATA_DIR is required");
  return args;
}

function readEndpoint(profile) {
  const activePortPath = path.join(profile, "DevToolsActivePort");
  const lines = fs.readFileSync(activePortPath, "utf8").trim().split(/\r?\n/);
  if (lines.length < 2 || !lines[0] || !lines[1]) throw new Error(`invalid DevToolsActivePort: ${activePortPath}`);
  return {
    active_port_path: activePortPath,
    profile_dir: profile,
    port: lines[0],
    browser_path: lines[1],
    base_url: `http://127.0.0.1:${lines[0]}`,
    browser_ws: `ws://127.0.0.1:${lines[0]}${lines[1]}`,
  };
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

class Cdp {
  constructor(endpoint, timeoutMs = 30000) {
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.endpoint);
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
        return;
      }
      if (!message.method) return;
      const key = `${message.sessionId ?? ""}:${message.method}`;
      for (const listener of this.listeners.get(key) ?? []) listener(message.params ?? {});
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP connection timed out")), this.timeoutMs);
      this.ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, {once: true});
      this.ws.addEventListener("error", (event) => {
        clearTimeout(timer);
        reject(new Error(String(event.message || event.type || event)));
      }, {once: true});
    });
  }

  on(method, sessionId, callback) {
    const key = `${sessionId ?? ""}:${method}`;
    const listeners = this.listeners.get(key) ?? [];
    listeners.push(callback);
    this.listeners.set(key, listeners);
  }

  waitFor(method, sessionId, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const key = `${sessionId ?? ""}:${method}`;
      const listener = (params) => {
        const listeners = this.listeners.get(key) ?? [];
        const position = listeners.indexOf(listener);
        if (position >= 0) listeners.splice(position, 1);
        clearTimeout(timer);
        resolve(params);
      };
      const listeners = this.listeners.get(key) ?? [];
      listeners.push(listener);
      this.listeners.set(key, listeners);
      const timer = setTimeout(() => {
        const current = this.listeners.get(key) ?? [];
        const position = current.indexOf(listener);
        if (position >= 0) current.splice(position, 1);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
    });
  }

  call(method, params = {}, sessionId = null, timeoutMs = this.timeoutMs) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify(sessionId ? {id, method, params, sessionId} : {id, method, params}));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function urlIdentity(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return {scheme: url.protocol.slice(0, -1), host: url.host, path: url.pathname || "/"};
  } catch {
    return {scheme: null, host: null, path: null};
  }
}

function sanitizeTarget(target) {
  return {
    target_id: target.targetId,
    type: target.type,
    title: target.title,
    url: urlIdentity(target.url),
    attached: target.attached,
  };
}

function sanitizeHistory(history) {
  return {
    current_index: history.currentIndex,
    entries: (history.entries ?? []).map((entry) => ({
      id: entry.id,
      title: entry.title,
      url: urlIdentity(entry.url),
    })),
  };
}

function safeMessage(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
}

function actionNetworkRows(rows, startIndex) {
  return rows.slice(startIndex).map((row) => ({...row}));
}

async function evaluate(cdp, sessionId, expression, timeoutMs = 30000) {
  const response = await cdp.call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  }, sessionId, timeoutMs);
  if (response.exceptionDetails) {
    throw new Error(`Runtime.evaluate exception: ${response.exceptionDetails.text || "unknown"}`);
  }
  return response.result?.value;
}

async function navigate(cdp, sessionId, url) {
  const loaded = cdp.waitFor("Page.loadEventFired", sessionId, 45000);
  await cdp.call("Page.navigate", {url}, sessionId, 45000);
  await loaded;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const readyState = await evaluate(cdp, sessionId, "document.readyState");
    if (readyState === "complete") break;
    await sleep(50);
  }
  await sleep(150);
}

async function captureScreenshot(cdp, sessionId, file) {
  const result = await cdp.call("Page.captureScreenshot", {format: "png", fromSurface: true}, sessionId, 30000);
  const bytes = Buffer.from(result.data, "base64");
  fs.writeFileSync(file, bytes);
  return {path: file, bytes: bytes.length, sha256: sha256Buffer(bytes)};
}

function inputPoint(snapshot) {
  const rect = snapshot?.print_control?.bounding_rect;
  if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error("print control has no usable bounding rectangle");
  return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
}

async function mouseClick(cdp, sessionId, point) {
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  }, sessionId);
  await cdp.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  }, sessionId);
}

async function keyboardActivation(cdp, sessionId, key) {
  const isEnter = key === "Enter";
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: isEnter ? "Enter" : " ",
    code: isEnter ? "Enter" : "Space",
    text: isEnter ? "\r" : " ",
    unmodifiedText: isEnter ? "\r" : " ",
    windowsVirtualKeyCode: isEnter ? 13 : 32,
    nativeVirtualKeyCode: isEnter ? 13 : 32,
  }, sessionId);
  await cdp.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: isEnter ? "Enter" : " ",
    code: isEnter ? "Enter" : "Space",
    windowsVirtualKeyCode: isEnter ? 13 : 32,
    nativeVirtualKeyCode: isEnter ? 13 : 32,
  }, sessionId);
}

async function targetInfos(cdp) {
  return (await cdp.call("Target.getTargets")).targetInfos ?? [];
}

async function attachPage(cdp, targetId) {
  const attached = await cdp.call("Target.attachToTarget", {targetId, flatten: true});
  const sessionId = attached.sessionId;
  await cdp.call("Page.enable", {}, sessionId);
  await cdp.call("Runtime.enable", {}, sessionId);
  await cdp.call("Network.enable", {}, sessionId);
  await cdp.call("Log.enable", {}, sessionId);
  return sessionId;
}

async function waitForPopups(cdp, parentTargetId, knownTargetIds, expectedCount) {
  const started = Date.now();
  const deadline = started + 6000;
  const minimumWait = expectedCount === 0 ? started + 700 : started;
  let candidates = [];
  while (Date.now() < deadline) {
    candidates = (await targetInfos(cdp)).filter((target) =>
      target.type === "page" &&
      target.targetId !== parentTargetId &&
      !knownTargetIds.has(target.targetId) &&
      target.openerId === parentTargetId &&
      urlIdentity(target.url).path?.startsWith("/printer--friendly/") === true,
    );
    if (candidates.length >= expectedCount && Date.now() >= minimumWait) return candidates;
    await sleep(50);
  }
  return candidates;
}

async function waitForDocument(cdp, sessionId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const readyState = await evaluate(cdp, sessionId, "document.readyState");
    if (readyState === "complete") return;
    await sleep(50);
  }
  throw new Error("popup document did not reach readyState complete");
}

async function runPopupPrintProbe({cdp, target, outputPath}) {
  const sessionId = await attachPage(cdp, target.targetId);
  try {
    await waitForDocument(cdp, sessionId);
    const identity = await evaluate(cdp, sessionId, `(() => ({title: document.title, href: location.href, ready_state: document.readyState, print_control_count: document.querySelectorAll(${JSON.stringify('a[href="javascript:;"][onclick*="window.print"]')}).length, print_handler: document.querySelector(${JSON.stringify('a[href="javascript:;"][onclick*="window.print"]')})?.getAttribute("onclick") ?? null}))()`);
    const selector = 'a[href="javascript:;"][onclick*="window.print"]';
    if (identity.print_control_count !== 1) throw new Error(`printer-friendly popup print control count was ${identity.print_control_count}`);
    await evaluate(cdp, sessionId, CHILD_INIT_SCRIPT);
    const baseline = await evaluate(cdp, sessionId, `window.__open43Issue777ChildPrint.snapshot("popup_baseline")`);
    await evaluate(cdp, sessionId, `window.__open43Issue777ChildPrint.beginAction("native_print_click")`);
    await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(selector)})?.focus()`);
    await sleep(20);
    const before = await evaluate(cdp, sessionId, `window.__open43Issue777ChildPrint.snapshot("before_native_print")`);
    const rect = before.print_control.bounding_rect;
    if (!rect || rect.width <= 0 || rect.height <= 0) throw new Error("popup print control has no usable bounding rectangle");
    const point = {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
    const historyBefore = sanitizeHistory(await cdp.call("Page.getNavigationHistory", {}, sessionId));
    await mouseClick(cdp, sessionId, point);
    const immediate = await evaluate(cdp, sessionId, `window.__open43Issue777ChildPrint.snapshot("immediate_after_input")`);
    await sleep(100);
    const after100 = await evaluate(cdp, sessionId, `window.__open43Issue777ChildPrint.snapshot("after_100ms")`);
    await sleep(400);
    const after500 = await evaluate(cdp, sessionId, `window.__open43Issue777ChildPrint.snapshot("after_500ms")`);
    const action = await evaluate(cdp, sessionId, "window.__open43Issue777ChildPrint.finishAction()") ;
    const historyAfter = sanitizeHistory(await cdp.call("Page.getNavigationHistory", {}, sessionId));
    const screenshot = await captureScreenshot(cdp, sessionId, outputPath);
    return {
      target: sanitizeTarget(target),
      identity,
      selector,
      snapshots: {baseline, before, immediate, after_100ms: after100, after_500ms: after500},
      action_timeline: action,
      print_calls: action.printCalls,
      history_before: historyBefore,
      history_after: historyAfter,
      history_entries_unchanged: JSON.stringify(historyBefore) === JSON.stringify(historyAfter),
      url_unchanged: [baseline, before, immediate, after100, after500].every((snapshot) => snapshot.url === identity.href),
      screenshot,
    };
  } finally {
    try { await cdp.call("Target.detachFromTarget", {sessionId}, null); } catch {}
  }
}

async function runOperation({cdp, sessionId, url, name, setupFocus, input, expectedPopups, screenshotPath, popupScreenshotPrefix, networkRows, runtimeEvents, logEvents, navigationEvents, targetId}) {
  await navigate(cdp, sessionId, url);
  const initial = await evaluate(cdp, sessionId, `window.__open43Issue777LivePrint.snapshot("initial")`);
  await evaluate(cdp, sessionId, `window.__open43Issue777LivePrint.beginAction(${JSON.stringify(name)})`);
  if (setupFocus) {
    await evaluate(cdp, sessionId, `document.querySelector(${JSON.stringify(PRINT_SELECTOR)})?.focus()`);
    await sleep(20);
  }
  const before = await evaluate(cdp, sessionId, `window.__open43Issue777LivePrint.snapshot("before_activation")`);
  const point = inputPoint(before);
  const historyBefore = sanitizeHistory(await cdp.call("Page.getNavigationHistory", {}, sessionId));
  const knownTargetIds = new Set((await targetInfos(cdp)).map((target) => target.targetId));
  const networkStart = networkRows.length;
  const runtimeStart = runtimeEvents.length;
  const logStart = logEvents.length;
  const navigationStart = navigationEvents.length;
  const popupPromise = waitForPopups(cdp, targetId, knownTargetIds, expectedPopups);
  let inputSequence;
  if (input === "click") {
    inputSequence = ["mousePressed", "mouseReleased"];
    await mouseClick(cdp, sessionId, point);
  } else if (input === "enter" || input === "space") {
    inputSequence = ["keyDown", "keyUp"];
    await keyboardActivation(cdp, sessionId, input === "enter" ? "Enter" : "Space");
  } else if (input === "rapid_repeated_click") {
    inputSequence = ["click-1-mousePressed", "click-1-mouseReleased", "click-2-mousePressed", "click-2-mouseReleased"];
    await mouseClick(cdp, sessionId, point);
    await mouseClick(cdp, sessionId, point);
  } else if (input === "sequential_repeated_click") {
    inputSequence = ["click-1-mousePressed", "click-1-mouseReleased", "wait-200ms", "click-2-mousePressed", "click-2-mouseReleased"];
    await mouseClick(cdp, sessionId, point);
    await sleep(200);
    await evaluate(cdp, sessionId, `window.__open43Issue777LivePrint.snapshot("between_repeats")`);
    await mouseClick(cdp, sessionId, point);
  } else throw new Error(`unknown operation input: ${input}`);
  const immediate = await evaluate(cdp, sessionId, `window.__open43Issue777LivePrint.snapshot("immediate_after_input")`);
  await sleep(100);
  const after100 = await evaluate(cdp, sessionId, `window.__open43Issue777LivePrint.snapshot("after_100ms")`);
  await sleep(400);
  const after500 = await evaluate(cdp, sessionId, `window.__open43Issue777LivePrint.snapshot("after_500ms")`);
  await sleep(500);
  const after1000 = await evaluate(cdp, sessionId, `window.__open43Issue777LivePrint.snapshot("after_1000ms")`);
  const action = await evaluate(cdp, sessionId, "window.__open43Issue777LivePrint.finishAction()");
  const historyAfter = sanitizeHistory(await cdp.call("Page.getNavigationHistory", {}, sessionId));
  const targetAfter = sanitizeTarget((await cdp.call("Target.getTargetInfo", {targetId}, null)).targetInfo);
  const finalScreenshot = await captureScreenshot(cdp, sessionId, screenshotPath);
  const popupTargets = await popupPromise;
  const popupObservations = [];
  for (let index = 0; index < popupTargets.length; index += 1) {
    const popup = popupTargets[index];
    popupObservations.push(await runPopupPrintProbe({
      cdp,
      target: popup,
      outputPath: `${popupScreenshotPrefix}-${index + 1}-after.png`,
    }));
  }
  const closedPopupTargetIds = [];
  for (const popup of popupTargets) {
    const result = await cdp.call("Target.closeTarget", {targetId: popup.targetId}, null);
    closedPopupTargetIds.push({target_id: popup.targetId, closed: result.success === true});
  }
  const remainingPopupTargetIds = (await targetInfos(cdp))
    .filter((target) => popupTargets.some((popup) => popup.targetId === target.targetId))
    .map((target) => target.targetId);
  const actionNetwork = actionNetworkRows(networkRows, networkStart);
  const actionRuntime = runtimeEvents.slice(runtimeStart).map((event) => ({...event}));
  const actionLog = logEvents.slice(logStart).map((event) => ({...event}));
  const actionNavigations = navigationEvents.slice(navigationStart).map((event) => ({...event}));
  const snapshots = {initial, before_activation: before, immediate_after_input: immediate, after_100ms: after100, after_500ms: after500, after_1000ms: after1000};
  const historySame = JSON.stringify(historyBefore) === JSON.stringify(historyAfter);
  const urlSame = [initial, before, immediate, after100, after500, after1000].every((snapshot) => snapshot.url === url);
  return {
    name,
    input,
    setup_focus: setupFocus,
    expected_popup_count: expectedPopups,
    input_sequence: inputSequence,
    snapshots,
    action_timeline: action,
    print_calls: action.printCalls,
    open_calls: action.openCalls,
    history_before: historyBefore,
    history_after: historyAfter,
    history_entries_unchanged: historySame,
    url_unchanged: urlSame,
    target_before: {target_id: targetId},
    target_after: targetAfter,
    cdp_navigation_events: actionNavigations,
    popup_targets: popupTargets.map(sanitizeTarget),
    popup_target_count: popupTargets.length,
    popup_observations: popupObservations,
    popup_cleanup: {closed: closedPopupTargetIds, remaining_target_ids: remainingPopupTargetIds},
    network: {
      scope: "parent_page_session_after_navigation_settle; unrelated public-page telemetry may be present",
      rows: actionNetwork,
      non_safe_request_count: actionNetwork.filter((row) => !["GET", "HEAD", "OPTIONS"].includes(row.method)).length,
    },
    runtime_events: actionRuntime,
    log_events: actionLog,
    final_screenshot: finalScreenshot,
  };
}

function registerObservers(cdp, sessionId, networkRows, runtimeEvents, logEvents, navigationEvents, targetId) {
  const pendingNetwork = new Map();
  cdp.on("Network.requestWillBeSent", sessionId, (params) => {
    const identity = urlIdentity(params.request?.url);
    const row = {
      request_id: params.requestId,
      method: params.request?.method,
      url: identity,
      resource_type: params.type ?? null,
      cdp_timestamp: params.timestamp ?? null,
      status: null,
    };
    pendingNetwork.set(params.requestId, row);
    networkRows.push(row);
  });
  cdp.on("Network.responseReceived", sessionId, (params) => {
    const row = pendingNetwork.get(params.requestId);
    if (!row) return;
    row.status = params.response?.status ?? null;
    row.response_resource_type = params.type ?? null;
  });
  cdp.on("Network.loadingFailed", sessionId, (params) => {
    const row = pendingNetwork.get(params.requestId);
    if (!row) return;
    row.loading_failed = params.errorText ?? "unknown";
  });
  cdp.on("Runtime.consoleAPICalled", sessionId, (params) => {
    const values = (params.args ?? []).map((arg) => arg.value ?? arg.description ?? arg.type).join(" ");
    runtimeEvents.push({type: "console", level: params.type, text: safeMessage(values), url: urlIdentity(params.executionContextId ? "" : "")});
  });
  cdp.on("Runtime.exceptionThrown", sessionId, (params) => {
    runtimeEvents.push({type: "exception", text: safeMessage(params.exceptionDetails?.text), description: safeMessage(params.exceptionDetails?.exception?.description)});
  });
  cdp.on("Log.entryAdded", sessionId, (params) => {
    logEvents.push({level: params.entry?.level, source: params.entry?.source, text: safeMessage(params.entry?.text), url: urlIdentity(params.entry?.url)});
  });
  cdp.on("Page.frameNavigated", sessionId, (params) => {
    if (params.frame?.id !== targetId) return;
    navigationEvents.push({url: urlIdentity(params.frame.url), name: params.frame.name ?? null});
  });
}

async function capture(args) {
  const profile = path.resolve(args.profile);
  const output = path.resolve(args.output);
  if (!fs.existsSync(path.join(profile, ".codex-cdp-profile"))) throw new Error(`profile is not marked Codex-owned: ${profile}`);
  if (fs.existsSync(output)) throw new Error(`refusing to overwrite existing evidence directory: ${output}`);
  fs.mkdirSync(output, {recursive: false});
  const endpoint = readEndpoint(profile);
  const version = await fetchJson(`${endpoint.base_url}/json/version`);
  const targetList = await fetchJson(`${endpoint.base_url}/json/list`);
  const browser = new Cdp(endpoint.browser_ws);
  await browser.connect();
  let sessionId = null;
  try {
    const browserVersion = await browser.call("Browser.getVersion");
    const preCaptureTargets = await browser.call("Target.getTargets");
    const created = await browser.call("Target.createTarget", {url: "about:blank"});
    const targetId = created.targetId;
    const closedPreCaptureTargets = [];
    for (const item of preCaptureTargets.targetInfos ?? []) {
      if (item.type !== "page" || item.targetId === targetId) continue;
      const result = await browser.call("Target.closeTarget", {targetId: item.targetId});
      closedPreCaptureTargets.push({target_id: item.targetId, url: urlIdentity(item.url), closed: result.success === true});
    }
    const target = (await browser.call("Target.getTargets")).targetInfos?.find((item) => item.targetId === targetId);
    if (!target) throw new Error("new task-owned page target was not available");
    sessionId = await attachPage(browser, target.targetId);
    await browser.call("Emulation.setDeviceMetricsOverride", {
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      deviceScaleFactor: VIEWPORT.device_scale_factor,
      mobile: false,
    }, sessionId);
    await browser.call("Page.addScriptToEvaluateOnNewDocument", {source: INIT_SCRIPT}, sessionId);
    const networkRows = [];
    const runtimeEvents = [];
    const logEvents = [];
    const navigationEvents = [];
    registerObservers(browser, sessionId, networkRows, runtimeEvents, logEvents, navigationEvents, target.targetId);
    await navigate(browser, sessionId, args.url);
    const identity = await evaluate(browser, sessionId, `(() => ({title: document.title, href: location.href, ready_state: document.readyState, has_wikidot: !!window.WIKIDOT, has_ozone: !!window.OZONE, print_count: document.querySelectorAll(${JSON.stringify(PRINT_SELECTOR)}).length, print_selector: ${JSON.stringify(PRINT_SELECTOR)} }))()`);
    if (identity.print_count !== 1) throw new Error(`expected exactly one authored print control, got ${identity.print_count}`);
    const baseline = await evaluate(browser, sessionId, `window.__open43Issue777LivePrint.snapshot("baseline")`);
    const baselineScreenshot = await captureScreenshot(browser, sessionId, path.join(output, "baseline.png"));
    const operations = {};
    const operationDefinitions = [
      ["click", false, "click", 1],
      ["enter", true, "enter", 1],
      ["space", true, "space", 0],
      ["rapid_repeated_click", true, "rapid_repeated_click", 2],
      ["sequential_repeated_click", true, "sequential_repeated_click", 2],
    ];
    for (const [name, setupFocus, input, expectedPopups] of operationDefinitions) {
      operations[name] = await runOperation({
        cdp: browser,
        sessionId,
        url: args.url,
        name,
        setupFocus,
        input,
        expectedPopups,
        screenshotPath: path.join(output, `${name}-after.png`),
        popupScreenshotPrefix: path.join(output, `${name}-popup`),
        networkRows,
        runtimeEvents,
        logEvents,
        navigationEvents,
        targetId: target.targetId,
      });
    }
    const allParentActionEvents = Object.values(operations).flatMap((operation) => operation.action_timeline?.timeline ?? []);
    const allChildActionEvents = Object.values(operations).flatMap((operation) => operation.popup_observations.flatMap((popup) => popup.action_timeline?.timeline ?? []));
    const allActionEvents = [...allParentActionEvents, ...allChildActionEvents];
    const beforePrintEvents = allActionEvents.filter((event) => event.kind === "window.event" && event.event_type === "beforeprint");
    const afterPrintEvents = allActionEvents.filter((event) => event.kind === "window.event" && event.event_type === "afterprint");
    const printMediaEvents = allActionEvents.filter((event) => event.kind === "media.event");
    const executableSha256 = fs.existsSync(CHROME_EXECUTABLE) ? await sha256File(CHROME_EXECUTABLE) : null;
    const captureScriptSha256 = await sha256File(CAPTURE_SCRIPT);
    const testScriptSha256 = fs.existsSync(TEST_SCRIPT) ? await sha256File(TEST_SCRIPT) : null;
    const artifact = {
      schema: "wikidot.open43_issue777_exact_live_print_transitions.v1",
      issue: 777,
      case_id: "A777_EXACT_LIVE_PRINT_TRANSITIONS",
      acceptance: "Match Wikidot-specific print focus and dialog-adjacent lifecycle.",
      result: "observed_live_public_read_only",
      captured_at: new Date().toISOString(),
      authority: {
        tier: "anonymous_read_only_live_behavior",
        page_url_requested: args.url,
        page_url_observed: identity.href,
        page_title: identity.title,
        mutation_performed: false,
        external_page_state_cleanup: "not_required_public_read_only",
      },
      specification: {
        path: "docs/wikidot-specifications/specifications/wiki-syntax/syntax-buttons.md",
        source_sha256: "f6f7c04da59ec4a7136cdbf9a1a8551543a9a8f338653c0683c69886b76f820f",
        observed_contract: "standalone button type print; href javascript:; and Wikidot printClick handler",
      },
      fixture: {
        selector: PRINT_SELECTOR,
        count: identity.print_count,
        page_identity: identity,
        baseline,
        baseline_screenshot: baselineScreenshot,
      },
      browser_identity: {
        endpoint_port: endpoint.port,
        user_agent: version["User-Agent"] ?? null,
        http_version: version,
        browser_get_version: browserVersion,
        executable_wsl_path: CHROME_EXECUTABLE,
        executable_sha256: executableSha256,
        profile_dir: profile,
        profile_marker_sha256: sha256Buffer(fs.readFileSync(path.join(profile, ".codex-cdp-profile"))),
        viewport: VIEWPORT,
      },
      acquisition: {
        cache_mode: "direct_live_browser",
        rationale: "native print lifecycle requires a live browser page; no replay/candidate/local runtime was used",
        network_observation_policy: "CDP rows retain method, host/path, resource type, status, and no headers/cookies/post data",
      initial_target_list: targetList.map(sanitizeTarget),
      pre_capture_cdp_targets: (preCaptureTargets.targetInfos ?? []).map(sanitizeTarget),
      precapture_closed_targets: closedPreCaptureTargets,
      fresh_page_target_id: target.targetId,
      },
      timeline_contract: {
        observations: ["baseline", "initial", "before_activation", "immediate_after_input", "after_100ms", "after_500ms", "after_1000ms"],
        operations: ["click", "enter", "space", "rapid_repeated_click", "sequential_repeated_click"],
        input_dispatch: "CDP Input.dispatchMouseEvent and Input.dispatchKeyEvent",
        standalone_activation_behavior: "Wikidot printClick opens a printer-friendly child window; the child exposes a separate PRINT THE PAGE window.print control",
        native_dialog_policy: "native print dialog was not automated, dismissed, or solved",
      },
      operations,
      native_print_observation: {
        headless_user_agent: String(version["User-Agent"] ?? "").includes("HeadlessChrome"),
        parent_wrapper_observed_print_calls: Object.values(operations).reduce((sum, operation) => sum + operation.print_calls.length, 0),
        popup_wrapper_observed_print_calls: Object.values(operations).reduce((sum, operation) => sum + operation.popup_observations.reduce((count, popup) => count + popup.print_calls.length, 0), 0),
        wrapper_observed_print_calls: Object.values(operations).reduce((sum, operation) => sum + operation.print_calls.length + operation.popup_observations.reduce((count, popup) => count + popup.print_calls.length, 0), 0),
        beforeprint_event_count: beforePrintEvents.length,
        afterprint_event_count: afterPrintEvents.length,
        print_media_event_count: printMediaEvents.length,
        limitation: "Headless Chrome exposes the instrumented window.print invocation/return and page-level beforeprint/afterprint/matchMedia observations, but no native print-dialog surface or trustworthy headful dialog-open/close interval. The popup probe observed each call for 500 ms after activation; no afterprint event appeared in that bounded window. The capture makes no timing claim about the unavailable native UI or a later afterprint event.",
      },
      cleanup_contract: {
        page_state: "unchanged; anonymous public page only",
        profile: "close run-created popup targets, then stop and remove the fresh marked profile after capture; finalize cleanup receipt separately",
        stop_command: "/home/roku/.agents/skills/chrome-cdp-direct-control/scripts/stop-cdp-chrome.sh --user-data-dir <profile>",
        remove_command: "/home/roku/.agents/skills/chrome-cdp-direct-control/scripts/remove-cdp-profile.sh --user-data-dir <profile>",
      },
      capture_script: {path: CAPTURE_SCRIPT, sha256: captureScriptSha256},
      artifact_test: {path: TEST_SCRIPT, sha256: testScriptSha256, command: `node ${TEST_SCRIPT} --artifact-dir ${output}`},
      retained_files: [
        path.join(output, "capture.json"),
        path.join(output, "baseline.png"),
        ...Object.keys(operations).map((name) => path.join(output, `${name}-after.png`)),
        ...Object.values(operations).flatMap((operation) => operation.popup_observations.map((popup) => popup.screenshot.path)),
      ],
    };
    fs.writeFileSync(path.join(output, "capture.json"), `${JSON.stringify(artifact, null, 2)}\n`, {flag: "wx"});
    process.stdout.write(JSON.stringify({ok: true, output, capture: path.join(output, "capture.json"), operation_names: Object.keys(operations)}, null, 2) + "\n");
  } finally {
    browser.close();
  }
}

async function finalize(args) {
  const output = path.resolve(args.output);
  const capturePath = path.join(output, "capture.json");
  if (!fs.existsSync(capturePath)) throw new Error(`missing capture: ${capturePath}`);
  const capture = JSON.parse(fs.readFileSync(capturePath, "utf8"));
  const profile = path.resolve(args.profile);
  const profileExists = fs.existsSync(profile);
  const activePortExists = fs.existsSync(path.join(profile, "DevToolsActivePort"));
  const markerExists = fs.existsSync(path.join(profile, ".codex-cdp-profile"));
  const cleanup = {
    schema: "wikidot.open43_issue777_profile_cleanup.v1",
    finalized_at: new Date().toISOString(),
    profile_dir: profile,
    profile_marker: ".codex-cdp-profile",
    stop_exit_code: args.stop_exit_code,
    remove_exit_code: args.remove_exit_code,
    profile_exists_after_commands: profileExists,
    devtools_active_port_exists_after_commands: activePortExists,
    marker_exists_after_commands: markerExists,
    status: !profileExists && !activePortExists && !markerExists && args.stop_exit_code === 0 && args.remove_exit_code === 0 ? "verified_removed" : "cleanup_incomplete",
    public_page_state: capture.authority.external_page_state_cleanup,
  };
  fs.writeFileSync(path.join(output, "cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`, {flag: "wx"});
  const files = fs.readdirSync(output, {withFileTypes: true})
    .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS")
    .map((entry) => entry.name)
    .sort();
  const lines = [];
  for (const file of files) lines.push(`${await sha256File(path.join(output, file))}  ${file}`);
  fs.writeFileSync(path.join(output, "SHA256SUMS"), `${lines.join("\n")}\n`, {flag: "wx"});
  process.stdout.write(JSON.stringify({ok: cleanup.status === "verified_removed", cleanup, hashes: path.join(output, "SHA256SUMS")}, null, 2) + "\n");
  if (cleanup.status !== "verified_removed") process.exitCode = 1;
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "finalize") await finalize(args);
  else await capture(args);
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
