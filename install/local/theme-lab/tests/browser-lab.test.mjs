import assert from "node:assert/strict";
import test from "node:test";

import {exercisePreviewInteractions, inspectBrokenImages, inspectPlatformFonts, launchBrowser, loadChromium, openPage, setViewport, screenshot} from "../src/browser-lab.mjs";

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

test("Japanese glyph diagnostics stay bounded when the requested font never resolves", async () => {
  const originals = {document: globalThis.document, getComputedStyle: globalThis.getComputedStyle};
  const probe = {id: "", style: {}, textContent: "", getBoundingClientRect: () => ({width: 120, height: 20}), remove() {}};
  globalThis.document = {
    querySelector: () => ({}), createElement: () => probe, body: {append() {}},
    fonts: {status: "loading", ready: new Promise(() => {}), load: () => new Promise(() => {}), check: () => false},
    getElementById: () => probe,
  };
  globalThis.getComputedStyle = () => ({fontFamily: "Noto Sans JP, sans-serif", fontSize: "16px", fontWeight: "400", fontStyle: "normal", lineHeight: "normal", letterSpacing: "normal"});
  const started = Date.now();
  try {
    const result = await inspectPlatformFonts({evaluate: async callback => callback("#page-content")}, "#page-content", {engine: "webkit"});
    assert.equal(result.portable_glyph_measurement.status, "fail");
    assert.ok(Date.now() - started < 5_500);
  } finally {
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
