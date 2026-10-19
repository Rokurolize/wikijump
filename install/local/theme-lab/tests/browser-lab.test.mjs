import assert from "node:assert/strict";
import test from "node:test";

import {exercisePreviewInteractions, inspectBrokenImages, inspectPlatformFonts, launchBrowser, loadChromium, openPage, setViewport, screenshot, waitForStylesheetsReady} from "../src/browser-lab.mjs";

test("browser launch forwards the explicit WebKit local transport policy", async () => {
  let received;
  const browserType={launch:async options=>{received=options;return {}}};
  await launchBrowser({chromium:browserType,proxy:{server:"http://127.0.0.1:9",bypass:"localhost,127.0.0.1,.localhost"}});
  assert.equal(received.proxy.server,"http://127.0.0.1:9");
  assert.equal(received.proxy.bypass,"localhost,127.0.0.1,.localhost");
});

test("opening a built local target records the runtime identity response header", async () => {
  const page={on(){},goto:async url=>({url:()=>url,status:()=>200,headerValue:async name=>name==='x-theme-lab-runtime-source-sha'?'a'.repeat(64):null,allHeaders:async()=>({'x-theme-lab-runtime-source-sha':'a'.repeat(64)})})};
  const browser={newContext:async()=>({newPage:async()=>page})};
  const opened=await openPage(browser,{url:'https://scpaiueouiuiuiui.wikijump.localhost:3398/boundary-check'});
  assert.equal(opened.__themeLabRuntimeIdentity.header_source_sha256,'a'.repeat(64));
  assert.equal(opened.__themeLabRuntimeIdentity.transport_origin,'https://scpaiueouiuiuiui.wikijump.localhost:3398');
});

test("viewport changes and screenshots reset horizontal and vertical scroll state", async () => {
  const calls = [];
  const page = {
    setViewportSize: async (size) => calls.push(["viewport", size]),
    evaluate: async (callback) => {
      const source = callback.toString();
      if (source.includes("window.scrollTo(0, 0)")) {
        assert.equal(source.includes('style.scrollBehavior = "auto"'), true);
        assert.equal(source.includes("root.scrollTop = 0"), true);
        assert.equal(source.includes("body.scrollTop = 0"), true);
        assert.equal(source.includes('document.querySelectorAll("*")'), true);
        assert.equal(source.includes("element.scrollLeft = 0"), true);
        assert.equal(source.includes("element.scrollTop = 0"), true);
        calls.push(["scroll-reset"]);
      } else if (source.includes("style.textContent")) {
        assert.equal(source.includes("theme-lab-screenshot-stability"), true);
        assert.equal(source.includes("transition: none !important"), true);
        calls.push(["stability-style"]);
      } else if (source.includes("requestAnimationFrame")) {
        calls.push(["settled-frame"]);
      } else {
        assert.equal(source.includes("theme-lab-screenshot-stability"), true);
        calls.push(["stability-cleanup"]);
      }
    },
    screenshot: async (options) => calls.push(["screenshot", options.path]),
  };
  await setViewport(page, {width: 390, height: 844});
  await screenshot(page, {path: "/tmp/theme-lab-scroll-reset.png"});
  assert.deepEqual(calls.map(([kind]) => kind), ["viewport", "scroll-reset", "scroll-reset", "stability-style", "settled-frame", "screenshot", "stability-cleanup"]);
});

test("image diagnostics wait for a replaced complete image to decode", async () => {
  const originalDocument = globalThis.document;
  const originalCss = globalThis.CSS;
  const image = {
    complete: true,
    naturalWidth: 0,
    naturalHeight: 0,
    currentSrc: "data:image/png;base64,local",
    src: "data:image/png;base64,local",
    alt: "hansarplogo.png",
    className: "image",
    decode: async () => { image.naturalWidth = 32; image.naturalHeight = 32; },
  };
  globalThis.document = {images: [image]};
  globalThis.CSS = {escape: (value) => value};
  try {
    const result = await inspectBrokenImages({evaluate: async (callback) => callback()});
    assert.equal(result.status, "pass");
    assert.equal(result.broken.length, 0);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalCss === undefined) delete globalThis.CSS;
    else globalThis.CSS = originalCss;
  }
});

test("image diagnostics report complete images without natural dimensions", async () => {
  const originalDocument = globalThis.document;
  const originalCss = globalThis.CSS;
  globalThis.document = {images: [{
    complete: true,
    naturalWidth: 0,
    naturalHeight: 0,
    currentSrc: "https://local.test/local--resized-images//badge.png/medium.jpg",
    src: "",
    alt: "badge.png",
    className: "image",
  }]};
  globalThis.CSS = {escape: (value) => value};
  try {
    const result = await inspectBrokenImages({evaluate: async (callback) => callback()});
    assert.equal(result.status, "fail");
    assert.equal(result.image_count, 1);
    assert.equal(result.broken[0].alt, "badge.png");
    assert.equal(result.broken[0].selector, "img.image");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalCss === undefined) delete globalThis.CSS;
    else globalThis.CSS = originalCss;
  }
});

test("Japanese glyph diagnostics use the requested font pair while unrelated faces remain pending", async () => {
  const originals = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
  };
  const fontStatus = "loading";
  const probe = {
    id: "",
    style: {},
    textContent: "",
    getBoundingClientRect: () => ({width: 120, height: 20}),
    remove() {},
  };
  globalThis.document = {
    querySelector: () => ({}),
    createElement: () => probe,
    body: {append() {}},
    fonts: {get status() { return fontStatus; }, ready: Promise.resolve(), load: async () => [], check: () => true},
    getElementById: () => probe,
  };
  globalThis.getComputedStyle = () => ({
    fontFamily: "InterVariable, sans-serif", fontSize: "16px", fontWeight: "400",
    fontStyle: "normal", lineHeight: "normal", letterSpacing: "normal", font: "400 16px InterVariable, sans-serif",
  });
  try {
    const result = await inspectPlatformFonts({
      evaluate: async callback => callback("#page-content"),
    }, "#page-content", {engine: "webkit"});
    assert.equal(result.portable_glyph_measurement.status, "pass");
    assert.equal(result.document_fonts_status, "loading");
    assert.equal(result.font_check, true);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("Japanese glyph diagnostics stay bounded when the requested font never resolves", async (t) => {
  const originals = {document: globalThis.document, getComputedStyle: globalThis.getComputedStyle};
  const originalPerformance = globalThis.performance;
  // Exercise the exact production 5s deadline with the test runner's fake
  // clock; scheduler pressure in concurrent CI workers must not add failures.
  t.mock.timers.enable({apis: ["setTimeout"]});
  let simulatedNow = 0;
  globalThis.performance = {now: () => simulatedNow};
  const probe = {id: "", style: {}, textContent: "", getBoundingClientRect: () => ({width: 120, height: 20}), remove() {}};
  globalThis.document = {
    querySelector: () => ({}), createElement: () => probe, body: {append() {}},
    fonts: {status: "loading", ready: new Promise(() => {}), load: () => new Promise(() => {}), check: () => false},
    getElementById: () => probe,
  };
  globalThis.getComputedStyle = () => ({fontFamily: "Noto Sans JP, sans-serif", fontSize: "16px", fontWeight: "400", fontStyle: "normal", lineHeight: "normal", letterSpacing: "normal"});
  try {
    const pending = inspectPlatformFonts({evaluate: async callback => callback("#page-content")}, "#page-content", {engine: "webkit"});
    let settled = false;
    void pending.then(() => {settled = true;});
    simulatedNow = 4999;
    t.mock.timers.tick(4999);
    for (let iteration = 0; iteration < 4; iteration += 1) await Promise.resolve();
    assert.equal(settled, false, "unresolved font must remain pending before the 5-second deadline");
    simulatedNow = 5000;
    t.mock.timers.tick(1);
    const result = await pending;
    assert.equal(result.portable_glyph_measurement.status, "fail");
    assert.equal(simulatedNow, 5000);
  } finally {
    t.mock.timers.reset();
    globalThis.performance = originalPerformance;
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("pointer and focus diagnostics search beyond the first five covered controls", async () => {
  const browser = await loadChromium().launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 320, height: 200}});
    await page.setContent(`<style>
      #page-content { position: relative; }
      #page-content a { display: inline-block; margin: 8px; }
      #cover { position: fixed; inset: 0; z-index: 1; }
      #page-content a:last-child { position: relative; z-index: 2; }
    </style><div id="page-content">
      <a href="#1">covered 1</a><a href="#2">covered 2</a><a href="#3">covered 3</a>
      <a href="#4">covered 4</a><a href="#5">covered 5</a><a href="#6">available control</a>
    </div><div id="cover"></div>`);
    const result = await exercisePreviewInteractions(page);
    assert.equal(result.pointer_focus.status, "pass");
    assert.equal(result.pointer_focus.skipped_controls, 5);
    assert.equal(result.pointer_focus.focused, true);
    assert.equal(result.pointer_focus.hovered, true);
  } finally {
    await browser.close();
  }
});

function stylesheetReadinessPage(links, {waitForFunction = null, failedRequests = []} = {}) {
  // Dispatch mock evaluate calls by function source the way the existing
  // tests in this file do: the helper lists applicable sheet hrefs first and
  // pending sheets second.
  const evaluateState = async (callback) => {
    const source = String(callback);
    if (source.includes("sheet === null")) {
      return links.filter((link) => !link.disabled && link.sheet === null).map((link) => link.href);
    }
    return links
      .filter((link) => {
        if (link.disabled) return false;
        if (link.media === "print") return false;
        return true;
      })
      .map((link) => link.href);
  };
  const page = {
    waitForFunction: waitForFunction ?? (async (predicate) => {
      const previousDocument = globalThis.document;
      const previousWindow = globalThis.window;
      globalThis.document = {querySelectorAll: () => links};
      globalThis.window = {matchMedia: (query) => ({matches: query !== "print"})};
      try {
        if (!predicate()) throw new Error("predicate false in readiness mock");
      } finally {
        if (previousDocument === undefined) delete globalThis.document;
        else globalThis.document = previousDocument;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
    }),
    evaluate: evaluateState,
  };
  if (failedRequests !== null) page.__themeLabNetwork = {failed_requests: failedRequests};
  return page;
}

test("stylesheet readiness resolves when every screen sheet is loaded", async () => {
  const page = stylesheetReadinessPage([
    {disabled: false, media: "", sheet: {}, href: "http://127.0.0.1/base.css"},
    {disabled: false, media: "screen", sheet: {}, href: "http://127.0.0.1/screen.css"},
  ]);
  await waitForStylesheetsReady(page, {timeout: 50});
});

test("stylesheet readiness skips disabled and non-matching media links", async () => {
  const page = stylesheetReadinessPage([
    {disabled: false, media: "", sheet: {}, href: "http://127.0.0.1/base.css"},
    {disabled: true, media: "", sheet: null, href: "http://127.0.0.1/disabled.css"},
    {disabled: false, media: "print", sheet: null, href: "http://127.0.0.1/print.css"},
  ]);
  await waitForStylesheetsReady(page, {timeout: 50});
});

test("stylesheet readiness rejects naming a sheet that never loads", async () => {
  const page = stylesheetReadinessPage(
    [{disabled: false, media: "", sheet: null, href: "http://127.0.0.1/late.css"}],
    {waitForFunction: async () => { throw new Error("Timeout 50ms exceeded."); }},
  );
  await assert.rejects(waitForStylesheetsReady(page, {timeout: 50}), /late\.css/u);
});

test("stylesheet readiness rejects a recorded failed sheet without waiting", async () => {
  let waited = false;
  const page = stylesheetReadinessPage(
    [{disabled: false, media: "", sheet: null, href: "http://127.0.0.1/gone.css"}],
    {
      failedRequests: [{url: "http://127.0.0.1/gone.css", reason: "HTTP 404"}],
      waitForFunction: async () => { waited = true; },
    },
  );
  await assert.rejects(waitForStylesheetsReady(page, {timeout: 50}), /gone\.css/u);
  assert.equal(waited, false);
});
