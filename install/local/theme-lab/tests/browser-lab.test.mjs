import assert from "node:assert/strict";
import test from "node:test";

import {inspectBrokenImages, setViewport, screenshot} from "../src/browser-lab.mjs";

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
