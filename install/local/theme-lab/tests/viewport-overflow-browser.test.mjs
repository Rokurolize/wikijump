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

test("hidden popup geometry is excluded while visible children and document overflow remain measured", async () => {
  const browser = await loadChromium().launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 320, height: 200}});
    await page.setContent(`<style>
      html, body { margin: 0; }
      #hidden { position: fixed; left: -50px; width: 100px; height: 30px; visibility: hidden; }
      #visible-child { display: block; visibility: visible; width: 80px; height: 20px; }
      #transparent { position: fixed; left: -100px; width: 150px; height: 30px; opacity: 0; }
      #unpainted-scroll { position: absolute; left: 310px; width: 40px; height: 10px; visibility: hidden; }
      #wide { width: 350px; height: 5px; }
    </style><div id="hidden"><span id="visible-child">visible</span></div>
      <div id="transparent">hidden</div><div id="unpainted-scroll"></div><div id="wide"></div>`);
    const result = (await collectViewportOverflow(page, [{id: 'test', width: 320, height: 200}])).test;
    assert.ok(result.overflow_sources.some(row => row.selector === '#visible-child'));
    assert.ok(!result.overflow_sources.some(row => ['#hidden', '#transparent', '#unpainted-scroll'].includes(row.selector)));
    assert.equal(result.viewport_escape_px, 50);
    assert.ok(result.document_overflow_px >= 30);
  } finally {await browser.close();}
});

test("root clipping bounds decorative paint without hiding unclipped escapes", async () => {
  const browser = await loadChromium().launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 320, height: 200}});
    await page.setContent('<style>html,body{margin:0;min-height:200px}body{overflow-x:hidden}#paint{position:absolute;left:-45px;width:140px;height:20px}</style><div id="paint"></div>');
    const viewport = {id: 'test', width: 320, height: 200};
    const clipped = (await collectViewportOverflow(page, [viewport])).test;
    assert.equal(clipped.viewport_escape_px, 0);
    await page.addStyleTag({content: 'body{overflow-x:visible}'});
    const visible = (await collectViewportOverflow(page, [viewport])).test;
    assert.equal(visible.viewport_escape_px, 45);
  } finally {await browser.close();}
});

test("a closed off-canvas drawer with only a fractional edge sliver is not viewport escape", async () => {
  const browser = await loadChromium().launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 320, height: 200}});
    await page.setContent(`<style>
      html, body { margin: 0; min-height: 200px; }
      #drawer { position: fixed; left: -158.5px; top: 0; width: 158.625px; height: 100px; overflow-x: hidden; }
      #drawer-link { display: block; width: 100%; height: 100%; }
    </style><aside id="drawer"><a id="drawer-link" href="#closed">closed drawer</a></aside>`);
    const result = (await collectViewportOverflow(page, [{id: "test", width: 320, height: 200}])).test;
    assert.equal(result.document_overflow_px, 0);
    assert.equal(result.viewport_escape_px, 0);
    assert.deepEqual(result.overflow_sources, []);
  } finally {
    await browser.close();
  }
});
