import {viewportEscape} from "./viewport-bounds.mjs";
import {parseStyleSheet} from "./css-probe.mjs";
import {parseCssDeclarations} from "./port-maintenance.mjs";
import {applyStylesheet, clearStylesheet, collectViewportOverflow, setViewport} from "./browser-lab.mjs";
import {activateNavigationControl, expandMobileTopSubmenu} from "./navigation-interaction.mjs";
import {openSidebar} from "./sidebar-interaction.mjs";

export const SURFACE_CONTRACT_SCHEMA = "theme_lab_surface_contract.v1";

const PROBE_PROPERTIES = [
  "display", "visibility", "position", "width", "height", "min-width", "max-width",
  "top", "right", "bottom", "left", "color", "background-color", "background-image",
  "background-size", "font-size", "line-height", "white-space", "overflow-x", "filter", "z-index",
];

const RESPONSIVE_PROPERTIES = new Set([
  "position", "width", "height", "min-width", "max-width", "top", "right", "bottom", "left",
  "background-size", "font-size", "line-height", "white-space", "overflow-x",
]);

export const KNOWN_THEME_SURFACES = Object.freeze([
  {
    id: "shell.container",
    selector_patterns: [/^(?:html|body|#container-wrap|#content-wrap|#main-content)(?:$|\b|\s|[>+~.#:[\]])/u],
    probes: [{selector: "body"}, {selector: "#container-wrap"}, {selector: "#content-wrap"}, {selector: "#main-content"}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "shell.header",
    selector_patterns: [/^#header(?:\b|\s|[>+~.#:[\]])/u],
    probes: [
      {selector: "#header"},
      {selector: "#header h1 a"},
      {selector: "#header h1 a", pseudo: "::before"},
      {selector: "#header h1 a", pseudo: "::after"},
      {selector: "#header h2 span"},
      {selector: "#header h2 span", pseudo: "::before"},
      {selector: "#header h2 span", pseudo: "::after"},
    ],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "shell.search",
    selector_patterns: [/#search-top-box/u],
    probes: [{selector: "#search-top-box"}, {selector: "#search-top-box-input"}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "shell.login",
    selector_patterns: [/#login-status|#account-topbutton/u],
    probes: [{selector: "#login-status"}, {selector: "#account-topbutton", optional: true}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "nav.top",
    selector_patterns: [/#top-bar/u, /\.top-bar/u],
    probes: [{selector: "#top-bar"}, {selector: "#top-bar .top-bar", optional: true}],
    states: [{id: "normal", viewports: ["desktop"]}],
  },
  {
    id: "nav.mobile-top",
    selector_patterns: [/\.mobile-top-bar/u, /\.open-menu/u],
    probes: [
      {selector: ".mobile-top-bar"},
      {selector: ".mobile-top-bar > ul > li > ul", optional: true},
      {selector: ".mobile-top-bar .open-menu a", optional: true},
    ],
    states: [{id: "submenu-expanded", viewports: ["mobile"]}],
  },
  {
    id: "nav.sidebar",
    selector_patterns: [/#side-bar/u, /\.side-block/u, /\.close-menu/u],
    probes: [{selector: "#side-bar"}, {selector: "#side-bar .side-block"}],
    states: [{id: "open", viewports: ["mobile"]}],
  },
  {
    id: "content.rating",
    selector_patterns: [/\.page-rate-widget-box/u, /\.rate-points/u, /\.rateup/u, /\.ratedown/u],
    probes: [{selector: ".page-rate-widget-box"}, {selector: ".page-rate-widget-box a", contrast: true}],
    states: [{id: "focused", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "content.article",
    selector_patterns: [/#page-title/u, /#page-content/u, /#page-info/u],
    probes: [{selector: "#page-title"}, {selector: "#page-content"}, {selector: "#page-info", optional: true}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "content.links",
    selector_patterns: [/^(?:a|#page-content\s+a)(?:$|[:.\[])/u],
    probes: [{selector: "#page-content a[href]", contrast: true}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "content.credit",
    selector_patterns: [/\.creditButton/u, /\.creditRate/u, /#u-credit-(?:view|otherwise)/u, /\.creditBottomRate/u],
    probes: [
      {selector: ".creditButton"},
      {selector: ".creditButton a", contrast: true},
      {selector: "#u-credit-view .modalbox", optional: true},
    ],
    states: [
      {id: "normal", viewports: ["desktop", "mobile"]},
      {id: "open", viewports: ["desktop", "mobile"]},
    ],
  },
  {
    id: "content.tabview",
    selector_patterns: [/\.yui-navset/u, /\.yui-nav(?:\b|[ .:[>+~])/u, /\.yui-content/u],
    probes: [{selector: ".yui-navset"}, {selector: ".yui-navset .yui-nav"}],
    states: [{id: "second-tab-selected", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "content.collapsible",
    selector_patterns: [/\.collapsible-block/u],
    probes: [{selector: ".collapsible-block"}],
    states: [{id: "expanded", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "content.table",
    selector_patterns: [/^(?:table|\.wiki-content-table)(?:$|\b|\s|[>+~.#:[\]])/u],
    probes: [{selector: "#page-content table"}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "content.blockquote",
    selector_patterns: [/^blockquote(?:$|\b|\s|[>+~.#:[\]])/u],
    probes: [{selector: "#page-content blockquote"}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "content.code",
    selector_patterns: [/\.code(?:$|\b|\s|[>+~.#:[\]])/u],
    probes: [{selector: "#page-content .code"}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "content.toc",
    selector_patterns: [/#toc(?:$|\b|\s|[>+~.#:[\]])/u],
    probes: [{selector: "#toc"}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "content.footnotes",
    selector_patterns: [/\.footnotes-footer/u, /\.footnoteref/u],
    probes: [{selector: ".footnotes-footer", optional: true}, {selector: ".footnoteref", optional: true}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "content.image-block",
    selector_patterns: [/\.scp-image-block/u, /(?:^|\s)div\.img(?:$|\b|\s|[>+~.#:[\]])/u],
    probes: [{selector: ".scp-image-block", optional: true}, {selector: "#page-content div.img", optional: true}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "page.actions",
    selector_patterns: [/#page-options/u, /#more-options-button/u, /#action-area/u],
    probes: [{selector: "#page-options-container"}, {selector: "#page-options-bottom"}, {selector: "#more-options-button", optional: true}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "page.history",
    selector_patterns: [/\.page-history/u, /#revision-list/u, /\.revision-diff/u, /#history-subarea/u],
    probes: [
      {selector: "#action-area .page-history"},
      {selector: "#action-area .page-history tr[id^='revision-row-']"},
    ],
    states: [{id: "history-list", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "page.files",
    selector_patterns: [/\.page-files/u, /\.file-list/u, /\.file-row/u, /\.file-name/u, /\.file-attribute/u],
    probes: [
      {selector: "#action-area .file-list"},
      // The maintained JP acceptance page has the real, evidenced empty-file
      // state. Keep the list itself required while allowing its row selector
      // to be absent when there are no attachments.
      {selector: "#action-area .file-name", optional: true},
    ],
    states: [{id: "attachment-list", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "shell.interwiki",
    selector_patterns: [/\.scpnet-interwiki/u],
    probes: [{selector: ".scpnet-interwiki-wrapper"}, {selector: ".scpnet-interwiki-frame"}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
  {
    id: "shell.footer-license",
    selector_patterns: [/#footer/u, /#license-area/u],
    probes: [{selector: "#footer"}, {selector: "#license-area"}],
    states: [{id: "normal", viewports: ["desktop", "mobile"]}],
  },
]);

const VIEWPORTS = Object.freeze({
  desktop: {id: "desktop", width: 1440, height: 1000},
  mobile: {id: "mobile", width: 390, height: 844},
});

function unique(values) {
  return [...new Set(values)];
}

function declarationProperties(rule) {
  try {
    return parseCssDeclarations(rule.body ?? "").map((row) => row.property);
  } catch {
    return [];
  }
}

export function normalizeSurfaceContract(value = {}) {
  if (value === true || value === "auto") return {schema: SURFACE_CONTRACT_SCHEMA, strict: true, custom_selectors: [], reviewed_exceptions: []};
  if (!value || typeof value !== "object") throw new Error("surface contract must be an object or 'auto'");
  if (value.schema !== SURFACE_CONTRACT_SCHEMA) throw new Error(`surface contract schema must be ${SURFACE_CONTRACT_SCHEMA}`);
  const custom = value.custom_selectors ?? [];
  const reviewed = value.reviewed_exceptions ?? [];
  if (!Array.isArray(custom)) throw new Error("surface contract custom_selectors must be an array");
  if (!Array.isArray(reviewed)) throw new Error("surface contract reviewed_exceptions must be an array");
  const seen = new Set();
  for (const row of custom) {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id.trim()) throw new Error("custom selector requires id");
    if (seen.has(row.id)) throw new Error(`duplicate custom selector id: ${row.id}`);
    seen.add(row.id);
    if (typeof row.selector !== "string" || !row.selector.trim()) throw new Error(`custom selector ${row.id} requires selector`);
    if (row.viewports !== undefined && (!Array.isArray(row.viewports) || row.viewports.some((id) => !VIEWPORTS[id]))) {
      throw new Error(`custom selector ${row.id} has unsupported viewports`);
    }
  }
  for (const row of reviewed) {
    if (!row || typeof row !== "object" || typeof row.kind !== "string" || !row.kind.trim()) throw new Error("reviewed exception requires kind");
    if (typeof row.rationale !== "string" || !row.rationale.trim()) throw new Error(`reviewed exception ${row.kind} requires rationale`);
  }
  return {schema: SURFACE_CONTRACT_SCHEMA, strict: value.strict !== false, custom_selectors: custom, reviewed_exceptions: reviewed};
}

export function analyzeThemeSurfaceUsage(cssText, contractValue = {}) {
  const contract = normalizeSurfaceContract(contractValue);
  const rules = parseStyleSheet(cssText);
  const surfaces = [];
  for (const surface of KNOWN_THEME_SURFACES) {
    const matches = rules.filter((rule) => surface.selector_patterns.some((pattern) => pattern.test(rule.selector)));
    if (!matches.length) continue;
    surfaces.push({
      id: surface.id,
      selectors: unique(matches.map((rule) => rule.selector)),
      properties: unique(matches.flatMap(declarationProperties)).sort(),
      at_contexts: unique(matches.flatMap((rule) => rule.atContext ?? [])).sort(),
      responsive: matches.some((rule) => (rule.atContext ?? []).some((entry) => entry.trim().toLowerCase().startsWith("@media"))),
      probes: surface.probes,
      states: surface.states,
    });
  }
  return {schema: SURFACE_CONTRACT_SCHEMA, strict: contract.strict, surfaces, custom_selectors: contract.custom_selectors, reviewed_exceptions: contract.reviewed_exceptions};
}

async function ensureRunOwnedSurfaceDom(page) {
  await page.evaluate(() => {
    const sidebar=document.querySelector('#side-bar');
    if(sidebar&&!sidebar.querySelector('.scpnet-interwiki-wrapper')){
      const wrapper=document.createElement('div');
      wrapper.className='scpnet-interwiki-wrapper';
      wrapper.dataset.themeLabSurfaceFixture='interwiki';
      const stylable=document.createElement('div');
      stylable.className='interwiki-stylable';
      const frame=document.createElement('iframe');
      frame.className='scpnet-interwiki-frame html-block-iframe';
      frame.title='Theme Lab local Interwiki surface fixture';
      frame.srcdoc='<!doctype html><html lang="ja"><body style="margin:0">Interwiki fixture</body></html>';
      stylable.append(frame);
      wrapper.append(stylable);
      sidebar.append(wrapper);
    }
  });
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function resetState(page) {
  await page.evaluate(() => {
    // Navigate the fragment so CSS :target is reset as well as the URL.
    location.hash = "";
    document.activeElement?.blur?.();
    window.scrollTo(0, 0);
  });
  // A viewport corner can be a real hover trigger (for example a collapsed
  // sidebar). Leave the viewport so reset does not open an unrelated control.
  await page.mouse.move(-16, -16).catch(() => {});
  await settle(page);
}

export async function cleanupSurfaceState(page, surfaceId, stateId) {
  if(surfaceId==='content.collapsible' && stateId==='expanded'){
    const block=page.locator('#page-content .collapsible-block').first();
    const unfolded=block.locator(':scope > .collapsible-block-unfolded');
    if(await unfolded.isVisible()){
      const control=block.locator('.collapsible-block-unfolded-link .collapsible-block-link:visible').first();
      await control.focus();await control.press('Enter');await unfolded.waitFor({state:'hidden'});
    }
    await resetState(page);return;
  }
  if (["page.history", "page.files"].includes(surfaceId)) {
    const close = page.locator("#action-area .action-area-close");
    // The mobile navigation drawer can remain above the action pane while a
    // surface capture is being torn down. This is cleanup, not an interaction
    // measurement: dispatch the pane's own close handler even when another
    // fixed layer covers its button.
    if (await close.count()) await close.evaluate(element => element.click());
    await page.locator(surfaceId === "page.history" ? "#action-area .page-history" : "#action-area .file-list").waitFor({state: "hidden", timeout: 5000});
  }
  await page.evaluate(async ({surfaceId: surface, stateId: state}) => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    if (surface === "nav.mobile-top" && state === "submenu-expanded") {
      document.querySelector(".mobile-top-bar > ul > li.theme-lab-surface-open")?.classList.remove("theme-lab-surface-open");
      document.getElementById("theme-lab-surface-state-style")?.remove();
    } else if ((surface === "nav.sidebar" && state === "open") || (surface === "content.credit" && state === "open")) {
      // Navigate the fragment so CSS :target is reset as well as the URL.
    location.hash = "";
    } else if (surface === "content.tabview" && state === "second-tab-selected") {
      document.querySelector(".yui-navset .yui-nav li a")?.click();
    } else if (surface === "content.collapsible" && state === "expanded") {
      const unfolded = document.querySelector(".collapsible-block .collapsible-block-unfolded");
      if (visible(unfolded)) document.querySelector(".collapsible-block .collapsible-block-link")?.click();
    }
    await settle();
  }, {surfaceId, stateId});
  await resetState(page);
}

export async function applySurfaceState(page, surfaceId, stateId) {
  await resetState(page);
  if (surfaceId === "nav.mobile-top" && stateId === "submenu-expanded") {
    await expandMobileTopSubmenu(page); await settle(page); return;
  }
  if (surfaceId === "nav.sidebar" && stateId === "open") {
    await openSidebar(page); await settle(page); return;
  }
  if(surfaceId==='content.collapsible' && stateId==='expanded'){
    const block=page.locator('#page-content .collapsible-block').first();
    const unfolded=block.locator(':scope > .collapsible-block-unfolded');
    if(!await unfolded.isVisible()){
      const control=block.locator('.collapsible-block-folded .collapsible-block-link:visible').first();
      await control.focus();await control.press('Enter');
    }
    await unfolded.waitFor({state:'visible'});await settle(page);return;
  }
  if (["page.history", "page.files"].includes(surfaceId)) {
    await page.locator(surfaceId === "page.history" ? "#history-button" : "#files-button").click({timeout: 5000});
    await page.locator(surfaceId === "page.history" ? "#action-area .page-history tr[id^='revision-row-']" : "#action-area .file-list").first().waitFor({state: "visible", timeout: 5000});
    await settle(page);
    return;
  }
  const result = await page.evaluate(async ({surfaceId: surface, stateId: state}) => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    try {
      if (surface === "content.rating" && state === "focused") {
        const control = document.querySelector(".page-rate-widget-box a");
        if (!control) return {ok: false, error: "rating focus target is absent"};
        control.focus({preventScroll: true});
        await settle();
        return document.activeElement === control ? {ok: true} : {ok: false, error: "rating control did not receive focus"};
      }
      if (surface === "content.credit" && state === "open") {
        const control = document.querySelector(".creditButton a");
        const modal = document.querySelector("#u-credit-view .modalbox");
        if (!control || !modal) return {ok: false, error: "credit fixture/control is absent"};
        location.hash = "#u-credit-view";
        await settle();
        return visible(modal) ? {ok: true} : {ok: false, error: "credit modal did not become visible"};
      }
      if (surface === "content.tabview" && state === "second-tab-selected") {
        const tabs = [...document.querySelectorAll(".yui-navset .yui-nav li a")];
        if (tabs.length < 2) return {ok: false, error: "second tab target is absent"};
        tabs[1].click();
        await settle();
        return tabs[1].closest("li")?.classList.contains("selected") ? {ok: true} : {ok: false, error: "second tab did not become selected"};
      }
      if (surface === "content.collapsible" && state === "expanded") {
        const control = document.querySelector(".collapsible-block .collapsible-block-link");
        const unfolded = document.querySelector(".collapsible-block .collapsible-block-unfolded");
        if (!control || !unfolded) return {ok: false, error: "collapsible fixture/control is absent"};
        if (!visible(unfolded)) control.click();
        await settle();
        return visible(unfolded) ? {ok: true} : {ok: false, error: "collapsible did not expand"};
      }
      return {ok: true};
    } catch (error) {
      return {ok: false, error: String(error?.message ?? error)};
    }
  }, {surfaceId, stateId});
  if (!result.ok) throw new Error(result.error);
}

async function collectProbe(page, probes) {
  return page.evaluate(({probes: probeList, properties}) => {
    const root = document.documentElement;
    const parseRgb = (value) => {
      const match = /^rgba?\(\s*([0-9.]+)[, ]+\s*([0-9.]+)[, ]+\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+))?\s*\)$/u.exec(value);
      if (!match) return null;
      return {r:Number(match[1]),g:Number(match[2]),b:Number(match[3]),a:match[4]===undefined?1:Number(match[4])};
    };
    const luminance = ({r,g,b}) => {
      const channel = (value) => { const x=value/255; return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4; };
      return 0.2126*channel(r)+0.7152*channel(g)+0.0722*channel(b);
    };
    const contrast = (foreground, background) => {
      const fg=parseRgb(foreground),bg=parseRgb(background);
      if(!fg||!bg||fg.a<1||bg.a<1)return null;
      const l1=luminance(fg),l2=luminance(bg);
      return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
    };
    const compactImage = (value) => {
      if (!value || value === "none") return "none";
      if (/^url\(["']?data:/u.test(value)) {
        const match=/^url\(["']?(data:[^;,]+)[;,]/u.exec(value);
        return `url(${match?.[1] ?? "data:<inline>"};<inline>)`;
      }
      return value.length > 320 ? `${value.slice(0,300)}…` : value;
    };
    const effectiveBackground = (element) => {
      let current=element;
      while(current){
        const style=getComputedStyle(current);
        const parsed=parseRgb(style.backgroundColor);
        if(style.backgroundImage && style.backgroundImage!=="none")return {color:style.backgroundColor,image:compactImage(style.backgroundImage)};
        if(parsed&&parsed.a>0.001)return {color:style.backgroundColor,image:"none"};
        current=current.parentElement;
      }
      const body=getComputedStyle(document.body);
      return {color:body.backgroundColor,image:compactImage(body.backgroundImage||"none")};
    };
    const rows = {};
    for (const probe of probeList) {
      const key = `${probe.selector}${probe.pseudo ?? ""}`;
      let element = null;
      try { element = document.querySelector(probe.selector); } catch (error) {
        rows[key] = {selector: probe.selector, pseudo: probe.pseudo ?? null, optional: !!probe.optional, error: String(error), present: false};
        continue;
      }
      if (!element) {
        rows[key] = {selector: probe.selector, pseudo: probe.pseudo ?? null, optional: !!probe.optional, present: false};
        continue;
      }
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element, probe.pseudo ?? null);
      const effectiveBackgroundValue=effectiveBackground(element);
      rows[key] = {
        selector: probe.selector,
        pseudo: probe.pseudo ?? null,
        optional: !!probe.optional,
        present: true,
        visible: rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse",
        rect: {left: rect.left, x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom},
        style: Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)])),
        effective_background_color: effectiveBackgroundValue.color,
        effective_background_image: effectiveBackgroundValue.image,
        contrast_ratio: probe.contrast && effectiveBackgroundValue.image==="none" ? contrast(style.color,effectiveBackgroundValue.color) : null,
      };
    }
    return {rows, document_overflow_px: Math.max(0, root.scrollWidth - root.clientWidth), document_width: root.scrollWidth, viewport_width: root.clientWidth};
  }, {probes, properties: PROBE_PROPERTIES});
}

async function captureMode(page, {surface, state, viewport, themed, effectiveCss, styleId}) {
  await setViewport(page, VIEWPORTS[viewport]);
  if (themed) await applyStylesheet(page, effectiveCss, styleId, {moveToEnd: true});
  else await clearStylesheet(page, styleId);
  let actionError = null;
  try { await applySurfaceState(page, surface.id, state.id); }
  catch (error) { actionError = String(error?.message ?? error); }
  const snapshot = await collectProbe(page, surface.probes);
  const navigationBounds = () => page.evaluate(({surfaceId}) => {
    // Measure only the navigation tree owned by this state. Forcing a hidden
    // desktop menu open during the mobile state creates geometry that users
    // cannot reach and can report synthetic viewport escapes.
    const selector = surfaceId === "nav.mobile-top"
      ? ".mobile-top-bar > ul > li > ul"
      : "#top-bar .top-bar > ul > li > ul";
    const menus=[...document.querySelectorAll(selector)];
    const rows=[];
    for(const [menuIndex,menu] of menus.entries()) {
      if(menu.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})) for(const [elementIndex,el] of [menu,...menu.querySelectorAll("li,a")].entries()) {
        if(el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}))rows.push({selector:el.tagName.toLowerCase(),owner:surfaceId,menu_index:menuIndex,element_index:elementIndex,rect:el.getBoundingClientRect().toJSON()});
      }
    }
    return rows;
  },{surfaceId:surface.id});
  snapshot.navigation_bounds = [];
  snapshot.navigation_actions = [];
  if (surface.id === "nav.mobile-top" && state.id === "submenu-expanded") {
    const parents = page.locator('.mobile-top-bar > ul > li:has(> ul)');
    for (let index = 0; index < await parents.count(); index++) {
      await page.mouse.move(0, 0); await settle(page);
      const parent = parents.nth(index);
      let error = null;
      try {await activateNavigationControl(page, parent.locator(':scope > a').first(), parent.locator(':scope > ul'));}
      catch (failure) {error = String(failure.message ?? failure); actionError ??= error;}
      await settle(page);
      snapshot.navigation_actions.push({index, action_error: error});
      snapshot.navigation_bounds.push(...(await navigationBounds()).map(row => ({...row, parent_index: index})));
    }
  } else if (surface.id.startsWith("nav.")) snapshot.navigation_bounds = await navigationBounds();
  const overflow = (await collectViewportOverflow(page, [VIEWPORTS[viewport]]))[viewport];
  let cleanupError = null;
  try { await cleanupSurfaceState(page, surface.id, state.id); }
  catch (error) { cleanupError = String(error?.message ?? error); }
  return {
    mode: themed ? "theme" : "baseline",
    surface: surface.id,
    state: state.id,
    viewport,
    action_error: actionError,
    cleanup_error: cleanupError,
    ...snapshot,
    document_overflow_px: overflow.document_overflow_px,
    content_overflow_px: overflow.content_overflow_px,
    overflow_sources: overflow.overflow_sources,
  };
}

function probeKey(probe) {
  return `${probe.selector}${probe.pseudo ?? ""}`;
}

function deriveSurfaceCapture(capture, surface, state) {
  const keys = new Set(surface.probes.map(probeKey));
  return {
    ...capture,
    surface: surface.id,
    state: state.id,
    rows: Object.fromEntries(Object.entries(capture.rows ?? {}).filter(([key]) => keys.has(key))),
  };
}

function recordSurfacePair({surface, state, viewport, baseline, theme, captures, issues, strict}) {
  captures.push(baseline, theme);
  for (const capture of [baseline, theme]) {
    if (capture.action_error) {
      issues.push({severity: strict ? "error" : "warn", kind: "surface_state_action_failed", surface: surface.id, state: state.id, viewport, mode: capture.mode, evidence: capture.action_error});
    }
    if (capture.cleanup_error) {
      issues.push({severity: strict ? "error" : "warn", kind: "surface_state_cleanup_failed", surface: surface.id, state: state.id, viewport, mode: capture.mode, evidence: capture.cleanup_error});
    }
    for (const row of Object.values(capture.rows)) {
      if (!row.present && !row.optional) {
        issues.push({severity: strict ? "error" : "warn", kind: "surface_fixture_missing", surface: surface.id, state: state.id, viewport, mode: capture.mode, selector: row.selector, pseudo: row.pseudo});
      }
      if (capture.mode === "theme" && row.present && row.visible && row.contrast_ratio !== null && row.contrast_ratio < 4.5) {
        issues.push({
          severity: "warn",
          kind: "surface_low_text_contrast",
          surface: surface.id,
          state: state.id,
          viewport,
          selector: row.selector,
          contrast_ratio: Number(row.contrast_ratio.toFixed(3)),
          foreground: row.style?.color ?? null,
          background: row.effective_background_color,
        });
      }
    }
  }
  if (surface.id === "nav.mobile-top" || surface.id === "nav.top") {
    const navigationIssue=(row,before)=>{
      const bounds=viewportEscape(row.rect,theme.viewport_width);
      const baselineBounds=before?.rect?viewportEscape(before.rect,baseline.viewport_width):null;
      if(bounds.off_left_px>(baselineBounds?.off_left_px??0)+1||bounds.off_right_px>(baselineBounds?.off_right_px??0)+1)
        issues.push({severity:"error",kind:"surface_navigation_viewport_escape",surface:surface.id,state:state.id,viewport,selector:row.selector,bounds,baseline_bounds:baselineBounds});
    };
    for (const [key,row] of Object.entries(theme.rows)) {
      if (!row.present || !row.visible || !row.rect) continue;
      const before=baseline.rows[key];
      navigationIssue(row,before?.present&&before.visible?before:null);
    }
    for (const row of theme.navigation_bounds ?? []) {
      const before=baseline.navigation_bounds?.find(other=>other.parent_index===row.parent_index&&other.menu_index===row.menu_index&&other.element_index===row.element_index);
      navigationIssue(row,before);
    }
  }
  const ownedOverflow = (theme.overflow_sources ?? []).some((source) => overflowBelongsToSurface(surface.id, source));
  if (!baseline.action_error && !theme.action_error && theme.document_overflow_px > baseline.document_overflow_px + 1 && ownedOverflow) {
    issues.push({severity: "error", kind: "surface_viewport_overflow", surface: surface.id, state: state.id, viewport, before_px: baseline.document_overflow_px, after_px: theme.document_overflow_px, overflow_sources:theme.overflow_sources});
  } else if (!baseline.action_error && !theme.action_error && theme.document_overflow_px > baseline.document_overflow_px + 1) {
    issues.push({severity: "error", kind: "surface_new_viewport_overflow", surface: surface.id, state: state.id, viewport, before_px: baseline.document_overflow_px, after_px: theme.document_overflow_px, overflow_sources:theme.overflow_sources});
  }
  for (const probe of surface.probes.filter((row) => row.contrast)) {
    const key=probeKey(probe);
    const before=baseline.rows?.[key],after=theme.rows?.[key];
    if(!before?.present||!after?.present||!after.visible)continue;
    if(after.effective_background_image!=="none"&&before.style?.color!==after.style?.color){
      issues.push({
        severity:"warn",
        kind:"surface_text_color_changed_on_image_background",
        surface:surface.id,state:state.id,viewport,selector:probe.selector,
        baseline_color:before.style?.color??null,
        theme_color:after.style?.color??null,
        background_image:compactBackgroundImage(after.effective_background_image),
      });
    }
  }
}

function overflowBelongsToSurface(surfaceId, source) {
  const tokens = [source?.selector ?? "", ...(source?.ancestors ?? [])];
  const has = (pattern) => tokens.some((token) => pattern.test(token));
  if (surfaceId === "shell.header") return has(/^h[12](?:\b|[.#])/u);
  if (surfaceId === "shell.search") return has(/#search-top-box/u);
  if (surfaceId === "shell.login") return has(/#login-status|#account-topbutton/u);
  if (surfaceId === "nav.top") return has(/#top-bar|\.top-bar/u) && !has(/\.mobile-top-bar/u);
  if (surfaceId === "nav.mobile-top") return has(/\.mobile-top-bar/u);
  if (surfaceId === "nav.sidebar") return has(/#side-bar/u);
  if (surfaceId === "content.rating") return has(/\.page-rate-widget-box|\.rate-points|\.rateup|\.ratedown/u);
  if (surfaceId === "content.credit") return has(/\.creditButton|\.creditRate|#u-credit-(?:view|otherwise)|\.creditBottomRate/u);
  if (surfaceId === "content.tabview") return has(/\.yui-navset|\.yui-nav|\.yui-content/u);
  if (surfaceId === "content.collapsible") return has(/\.collapsible-block/u);
  if (surfaceId === "content.table") return has(/\btable\b|\.wiki-content-table/u);
  if (surfaceId === "content.blockquote") return has(/\bblockquote\b/u);
  if (surfaceId === "content.code") return has(/\.code\b/u);
  if (surfaceId === "content.toc") return has(/#toc/u);
  if (surfaceId === "content.footnotes") return has(/\.footnotes-footer|\.footnoteref/u);
  if (surfaceId === "content.image-block") return has(/\.scp-image-block|\.img\b/u);
  if (surfaceId === "page.actions") return has(/#page-options|#more-options-button|#action-area/u);
  if (surfaceId === "shell.interwiki") return has(/\.scpnet-interwiki/u);
  if (surfaceId === "shell.footer-license") return has(/#footer|#license-area/u);
  if (surfaceId === "shell.container" || surfaceId === "content.article" || surfaceId === "content.links") return has(/#page-content|#main-content|#content-wrap/u);
  return false;
}

function responsiveDrift(surface, captures) {
  const issues = [];
  for (const probe of surface.probes) {
    const key = `${probe.selector}${probe.pseudo ?? ""}`;
    const baselineDesktop = captures.find((row) => row.mode === "baseline" && row.viewport === "desktop" && row.state === "normal")?.rows?.[key];
    const baselineMobile = captures.find((row) => row.mode === "baseline" && row.viewport === "mobile" && row.state === "normal")?.rows?.[key];
    const themeDesktop = captures.find((row) => row.mode === "theme" && row.viewport === "desktop" && row.state === "normal")?.rows?.[key];
    const themeMobile = captures.find((row) => row.mode === "theme" && row.viewport === "mobile" && row.state === "normal")?.rows?.[key];
    if (!baselineDesktop?.present || !baselineMobile?.present || !themeDesktop?.present || !themeMobile?.present) continue;
    for (const property of RESPONSIVE_PROPERTIES) {
      if (!surface.properties.includes(property)) continue;
      const bd = baselineDesktop.style?.[property] ?? "";
      const bm = baselineMobile.style?.[property] ?? "";
      const td = themeDesktop.style?.[property] ?? "";
      const tm = themeMobile.style?.[property] ?? "";
      if (!bd || !bm || bd === bm || !td || !tm || td !== tm) continue;
      if (property === "font-size" && /^0(?:px|em|rem|%)?$/u.test(td.trim())) continue;
      issues.push({
        severity: "warn",
        kind: "baseline_responsive_behavior_flattened",
        surface: surface.id,
        selector: probe.selector,
        pseudo: probe.pseudo ?? null,
        property,
        baseline: {desktop: bd, mobile: bm},
        theme: {desktop: td, mobile: tm},
      });
    }
  }
  return issues;
}

function compactBackgroundImage(value) {
  if (typeof value !== "string") return value ?? null;
  if (value.startsWith('url("data:') || value.startsWith("url('data:")) {
    const mime = /^url\(["']?(data:[^;,]+)[;,]/u.exec(value)?.[1] ?? "data:<inline>";
    return `url(${mime};<inline>)`;
  }
  return value.length > 320 ? `${value.slice(0, 300)}…` : value;
}

export async function captureCustomSelectorCoverage(page, contractValue = {}) {
  const contract = normalizeSurfaceContract(contractValue);
  const rows = [];
  for (const spec of contract.custom_selectors) {
    for (const viewport of spec.viewports ?? ["desktop", "mobile"]) {
      await setViewport(page, VIEWPORTS[viewport]);
      let count = 0;
      let error = null;
      try { count = await page.locator(spec.selector).count(); }
      catch (caught) { error = String(caught?.message ?? caught); }
      rows.push({id: spec.id, selector: spec.selector, viewport, count, error, reason: spec.reason ?? null});
    }
  }
  return rows;
}

export async function runKnownSurfaceContract(page, {css, effectiveCss = css, styleId, contractValue = {}}) {
  const usage = analyzeThemeSurfaceUsage(css, contractValue);
  await ensureRunOwnedSurfaceDom(page);
  const captures = [];
  const issues = [];
  // All `normal` surfaces share the same page state. Measure the union of
  // their probes once per viewport/mode, then fan that evidence back out to
  // each touched surface. This avoids O(surface_count) repeated viewport/style
  // churn while preserving per-surface issue attribution.
  for (const viewport of Object.keys(VIEWPORTS)) {
    const normalRows = usage.surfaces.flatMap((surface) =>
      surface.states
        .filter((state) => state.id === "normal" && state.viewports.includes(viewport))
        .map((state) => ({surface, state})),
    );
    if (!normalRows.length) continue;
    const probesByKey = new Map();
    for (const {surface} of normalRows) for (const probe of surface.probes) probesByKey.set(probeKey(probe), probe);
    const sharedSurface = {id: "shared.normal", probes: [...probesByKey.values()]};
    const sharedState = {id: "normal"};
    const baselineShared = await captureMode(page, {surface: sharedSurface, state: sharedState, viewport, themed: false, effectiveCss, styleId});
    const themeShared = await captureMode(page, {surface: sharedSurface, state: sharedState, viewport, themed: true, effectiveCss, styleId});
    for (const {surface, state} of normalRows) {
      recordSurfacePair({
        surface,state,viewport,
        baseline:deriveSurfaceCapture(baselineShared,surface,state),
        theme:deriveSurfaceCapture(themeShared,surface,state),
        captures,issues,strict:usage.strict,
      });
    }
  }
  for (const surface of usage.surfaces) {
    for (const state of surface.states.filter((row) => row.id !== "normal")) {
      for (const viewport of state.viewports) {
        const baseline=await captureMode(page,{surface,state,viewport,themed:false,effectiveCss,styleId});
        const theme=await captureMode(page,{surface,state,viewport,themed:true,effectiveCss,styleId});
        recordSurfacePair({surface,state,viewport,baseline,theme,captures,issues,strict:usage.strict});
      }
    }
  }
  for (const surface of usage.surfaces) {
    issues.push(...responsiveDrift(surface, captures));
  }
  const reviewedFindings=[];
  const remainingIssues=[];
  for(const issue of issues){
    const review=issue.severity!=="error"?usage.reviewed_exceptions.find((row)=>
      row.kind===issue.kind&&
      (row.surface===undefined||row.surface===issue.surface)&&
      (row.state===undefined||row.state===issue.state)&&
      (row.viewport===undefined||row.viewport===issue.viewport)&&
      (row.selector===undefined||row.selector===issue.selector)&&
      (row.property===undefined||row.property===issue.property)
    ):null;
    if(review)reviewedFindings.push({...issue,reviewed:true,rationale:review.rationale});
    else remainingIssues.push(issue);
  }
  await applyStylesheet(page, effectiveCss, styleId, {moveToEnd: true});
  await resetState(page);
  return {schema: SURFACE_CONTRACT_SCHEMA, strict: usage.strict, usage, captures, issues:remainingIssues, reviewed_findings:reviewedFindings};
}

export function issuesFromCustomSelectorCoverage(rows, strict = true) {
  return rows.filter((row) => row.error || row.count === 0).map((row) => ({
    severity: strict ? "error" : "warn",
    kind: "custom_surface_selector_missing",
    surface: row.id,
    selector: row.selector,
    viewport: row.viewport,
    evidence: row.error ?? "selector matched zero elements",
  }));
}
