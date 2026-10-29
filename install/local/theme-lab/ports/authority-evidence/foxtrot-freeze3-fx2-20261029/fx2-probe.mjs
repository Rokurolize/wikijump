// Foxtrot E-fx2 toggle probe v2 (OD-T3-b). Replicates the theme-lab
// session frame used by the TL-02 full check (src/session-server.mjs open()
// + check() surface-contract setup), without the daemon:
//   goto contract fixture page; disable the sigma stylesheet link;
//   apply fixtures/scp-jp-sigma9-offline.css as #theme-lab-target-baseline;
//   replace #header h1/h2 from fixtures/scp-jp-header.html;
//   set #top-bar innerHTML = fixtures/scp-jp-navigation.html;
//   set #side-bar innerHTML = fixtures/scp-jp-sidebar.html (+ interwiki fixture).
// Variants: baseline = no candidate style (instrument baseline mode:
// clearStylesheet of the live-css id); current / toggled = candidate CSS
// applied as #theme-lab-live-css and moved to head end (instrument themed
// mode). Measurement mirrors src/theme-surface-contract.mjs captureMode for
// nav.mobile-top / submenu-expanded at mobile 390x844: for each parent in
// turn, mouse to (0,0), settle, activateNavigationControl (instrument code),
// settle, collect visible submenu bounds (ul + li + a) tagged parent_index.
// Deviation from the full check: the Deepwell surface-fixture preview into
// #page-content is not applied (page content only; the top-bar chrome under
// measurement is fully fixture-driven). Frame fidelity is validated by
// comparing the baseline and current variants against the TL-02 raw result.
// Usage: node fx2-probe.mjs --out=<receipt.json>
import {createRequire} from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const {chromium, webkit} = require("/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/framerail/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright/index.js");
const {activateNavigationControl} = await import("/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/install/local/theme-lab/src/navigation-interaction.mjs");
const {applyStylesheet} = await import("/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/install/local/theme-lab/src/browser-lab.mjs");
const RT = "/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023";
const LAB = RT + "/install/local/theme-lab";
const EV = LAB + "/ports/authority-evidence/foxtrot-freeze3-fx2-20261029";
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf("="); return [a.slice(2, i), a.slice(i + 1)]; }));
const sha = b => crypto.createHash("sha256").update(b).digest("hex");
const ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:3410";
const PAGE = "run-owned:theme-lab-visual-acceptance-imported-20260924";
const FIX = {
  baselineCss: LAB + "/fixtures/scp-jp-sigma9-offline.css",
  header: LAB + "/fixtures/scp-jp-header.html",
  navigation: LAB + "/fixtures/scp-jp-navigation.html",
  sidebar: LAB + "/fixtures/scp-jp-sidebar.html",
  interwiki: LAB + "/fixtures/scp-jp-interwiki.html",
};
const VARIANTS = [
  {name: "baseline", file: null},
  {name: "current", file: EV + "/candidate-current.css"},
  {name: "toggled", file: EV + "/candidate-toggled.css"},
];
const TYPES = {".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".css": "text/css", ".gif": "image/gif", ".webp": "image/webp", ".jpg": "image/jpeg"};
const ASSET_DIRS = ["ports/shared-replay-assets", "ports/foxtrot/assets", "ports/site/page-assets"];
async function settle(page) {
  await page.evaluate(() => { for (const a of document.getAnimations()) { try { a.finish(); } catch {} } });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);
}
const engines = {chromium, webkit};
const receipt = {schema: "theme_lab_freeze3_fx2_probe.v2", measured_at: new Date().toISOString(), origin: ORIGIN, page: PAGE, viewport: {width: 390, height: 844}, inputs: {}, fixtures: {}, runs: []};
for (const [k, f] of Object.entries(FIX)) receipt.fixtures[k] = {file: f, sha256: sha(fs.readFileSync(f))};
for (const v of VARIANTS) if (v.file) receipt.inputs[v.name] = {file: v.file, sha256: sha(fs.readFileSync(v.file))};
const baselineCss = fs.readFileSync(FIX.baselineCss, "utf8");
const headerHtml = fs.readFileSync(FIX.header, "utf8");
const navigationHtml = fs.readFileSync(FIX.navigation, "utf8");
const sidebarHtml = fs.readFileSync(FIX.sidebar, "utf8");
const interwikiHtml = fs.readFileSync(FIX.interwiki, "utf8");
for (const [engineName, engine] of Object.entries(engines)) {
  const browser = await engine.launch({headless: true});
  const engineRun = {engine: engineName, browser_version: browser.version(), variants: []};
  receipt.runs.push(engineRun);
  try {
    for (const variant of VARIANTS) {
      const context = await browser.newContext({ignoreHTTPSErrors: true, viewport: {width: 390, height: 844}, deviceScaleFactor: 1});
      await context.route("**/*", async route => {
        const u = new URL(route.request().url());
        if (u.protocol === "data:" || u.protocol === "blob:") return route.continue();
        if (u.origin === ORIGIN) {
          const name = decodeURIComponent(u.pathname.replace(/^\//u, ""));
          if (/^[0-9a-f]{64}\.[a-z0-9]+$/u.test(name)) {
            for (const dir of ASSET_DIRS) {
              const file = path.join(LAB, dir, name);
              if (fs.existsSync(file)) return route.fulfill({status: 200, contentType: TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream", body: fs.readFileSync(file)});
            }
          }
          return route.continue();
        }
        return route.abort("blockedbyclient");
      });
      const page = await context.newPage();
      const run = {variant: variant.name, navigation_bounds: [], navigation_actions: []};
      try {
        const response = await page.goto(ORIGIN + "/" + encodeURIComponent(PAGE), {waitUntil: "load", timeout: 60000});
        run.http_status = response?.status() ?? null;
        await page.waitForSelector("#top-bar", {timeout: 30000});
        await page.waitForTimeout(2000);
        // session open() fixture application
        await page.locator('link[rel="stylesheet"][href^="/wikidot/styles/sigma-"]').evaluateAll(links => links.forEach(link => { link.disabled = true; link.media = "not all"; }));
        await applyStylesheet(page, baselineCss, "theme-lab-target-baseline");
        await page.locator("#header").evaluate((header, html) => {
          const source = document.createElement("template"); source.innerHTML = html;
          for (const tag of ["h1", "h2"]) header.querySelector(tag).replaceWith(source.content.querySelector(tag).cloneNode(true));
        }, headerHtml);
        await page.locator("#top-bar").evaluate((element, html) => { element.innerHTML = html; }, navigationHtml);
        await page.evaluate(({sidebar, interwiki}) => {
          const bar = document.querySelector("#side-bar");
          if (bar) { bar.innerHTML = sidebar; bar.querySelectorAll(".scpnet-interwiki-wrapper").forEach(n => n.remove()); bar.insertAdjacentHTML("beforeend", interwiki); }
        }, {sidebar: sidebarHtml, interwiki: interwikiHtml});
        // variant CSS (instrument themed mode) or none (baseline mode)
        if (variant.file) await applyStylesheet(page, fs.readFileSync(variant.file, "utf8"), "theme-lab-live-css", {moveToEnd: true});
        await page.waitForTimeout(1500);
        await settle(page);
        run.supports_webkit_hyphens = await page.evaluate(() => CSS.supports("(-webkit-hyphens: none)"));
        run.parent_labels = await page.evaluate(() => [...document.querySelectorAll(".mobile-top-bar > ul > li:has(> ul) > a")].map(a => (a.textContent || "").trim()));
        const parents = page.locator(".mobile-top-bar > ul > li:has(> ul)");
        const count = await parents.count();
        run.parent_count = count;
        for (let index = 0; index < count; index++) {
          await page.mouse.move(0, 0); await settle(page);
          const parent = parents.nth(index);
          let error = null;
          try { await activateNavigationControl(page, parent.locator(":scope > a").first(), parent.locator(":scope > ul")); }
          catch (failure) { error = String(failure.message ?? failure); }
          await settle(page);
          run.navigation_actions.push({index, action_error: error});
          const rows = await page.evaluate(() => {
            const menus = [...document.querySelectorAll(".mobile-top-bar > ul > li > ul")];
            const out = [];
            for (const [menuIndex, menu] of menus.entries()) {
              if (menu.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) for (const [elementIndex, el] of [menu, ...menu.querySelectorAll("li,a")].entries()) {
                if (el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) out.push({selector: el.tagName.toLowerCase(), menu_index: menuIndex, element_index: elementIndex, rect: el.getBoundingClientRect().toJSON()});
              }
            }
            return out;
          });
          run.navigation_bounds.push(...rows.map(row => ({...row, parent_index: index})));
          if (index === count - 1) {
            run.last_submenu_computed = await parent.locator(":scope > ul").evaluate(el => { const cs = getComputedStyle(el); return {left: cs.left, right: cs.right, position: cs.position}; }).catch(e => ({error: String(e.message ?? e)}));
          }
        }
      } catch (e) { run.fatal_error = String(e?.message ?? e); }
      engineRun.variants.push(run);
      await context.close();
    }
  } finally { await browser.close(); }
}
fs.writeFileSync(args.out, JSON.stringify(receipt, null, 1) + "\n");
console.log(JSON.stringify({out: args.out, runs: receipt.runs.map(r => ({engine: r.engine, variants: r.variants.map(v => ({variant: v.variant, status: v.http_status, parents: v.parent_count, labels: v.parent_labels, bounds: v.navigation_bounds.length, fatal: v.fatal_error ?? null}))}))}));
