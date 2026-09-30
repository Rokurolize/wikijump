import test from "node:test";
import assert from "node:assert/strict";
import {loadChromium, collectViewportOverflow} from "../src/browser-lab.mjs";

test("viewport overflow reports partial left escapes without treating a closed drawer as failure", async () => {
  const browser = await loadChromium().launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 320, height: 200}});
    await page.setContent(`<style>
      html, body { margin: 0; min-height: 100px; }
      #partial-left { position: absolute; left: -20px; top: 10px; width: 40px; height: 10px; }
      #closed-drawer { position: fixed; left: -400px; top: 0; width: 200px; height: 100px; }
    </style><div id="partial-left"></div><div id="closed-drawer"></div>`);
    const result = (await collectViewportOverflow(page, [{id: "test", width: 320, height: 200}])).test;
    assert.ok(result.viewport_escape_px >= 20);
    assert.ok(result.overflow_sources.some(row => row.selector === "#partial-left" && row.off_left_px >= 20));
    assert.ok(!result.overflow_sources.some(row => row.selector === "#closed-drawer"));
  } finally {
    await browser.close();
  }
});
