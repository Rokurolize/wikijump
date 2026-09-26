// Browser-side primitives for the theme-lab.
//
// Wraps Playwright (resolved from the Framerail workspace, like the existing
// verification harness) with the operations an agent needs for a fast
// edit -> verdict loop: live stylesheet replacement (no reload), selector match
// counts, per-element geometry/computed style, and cross-origin stylesheet
// rule extraction.

import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {parseStyleSheet} from "./css-probe.mjs";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BROWSER_ROOT = path.resolve(MODULE_DIR, "../../../../framerail");

export function loadChromium(browserRoot = DEFAULT_BROWSER_ROOT) {
  const requireFromRoot = createRequire(path.join(browserRoot, "package.json"));
  for (const name of ["playwright", "@playwright/test"]) {
    try {
      const loaded = requireFromRoot(name);
      if (loaded?.chromium) return loaded.chromium;
    } catch {
      // try the next candidate
    }
  }
  throw new Error(
    `could not load Playwright from ${browserRoot}; run pnpm install in framerail`,
  );
}

export async function launchBrowser({chromium, cdpEndpoint = null, executablePath = null, headless = true, args = []} = {}) {
  if (cdpEndpoint) return chromium.connectOverCDP(cdpEndpoint);
  return chromium.launch({executablePath: executablePath ?? undefined, headless, args});
}

export async function openPage(browser, {url = "about:blank", viewport = null, ignoreHttpsErrors = true, localOnly = false} = {}) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: ignoreHttpsErrors,
    ...(viewport ? {viewport} : {}),
  });
  const network = {blocked_external_attempts: 0, blocked_urls: [], failed_requests: []};
  if (localOnly) {
    await context.route("**/*", (route) => {
      const requestUrl = route.request().url();
      const parsed = new URL(requestUrl);
      const host = parsed.hostname.toLowerCase();
      if (parsed.protocol === "data:" || parsed.protocol === "blob:" || host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1") {
        return route.continue();
      }
      network.blocked_external_attempts += 1;
      if (network.blocked_urls.length < 10 && !network.blocked_urls.includes(requestUrl)) network.blocked_urls.push(requestUrl);
      return route.abort("blockedbyclient");
    });
  }
  const page = await context.newPage();
  page.__themeLabContext = context;
  page.__themeLabNetwork = network;
  page.on("requestfailed", (request) => {
    if (network.failed_requests.length < 30) {
      const requestUrl = request.url();
      network.failed_requests.push({url: requestUrl.startsWith("data:") ? requestUrl.slice(0, requestUrl.indexOf(",") + 1) : requestUrl, reason: request.failure()?.errorText ?? "request failed"});
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && network.failed_requests.length < 30) {
      const responseUrl = response.url();
      network.failed_requests.push({url: responseUrl.startsWith("data:") ? responseUrl.slice(0, responseUrl.indexOf(",") + 1) : responseUrl, reason: `HTTP ${response.status()}`});
    }
  });
  if (url && url !== "about:blank") {
    await page.goto(url, {waitUntil: "domcontentloaded", timeout: 30_000});
  }
  return page;
}

export async function closePage(page) {
  const context = page.__themeLabContext;
  await page.close().catch(() => {});
  await context?.close().catch(() => {});
}

export async function navigate(page, url) {
  await page.goto(url, {waitUntil: "domcontentloaded", timeout: 30_000});
  return page.url();
}

export async function applyStylesheet(page, css, id = "theme-lab-live-css") {
  await page.evaluate(
    ({id: styleId, text}) => {
      let element = document.getElementById(styleId);
      if (!element) {
        element = document.createElement("style");
        element.id = styleId;
        document.head.appendChild(element);
      }
      element.textContent = text;
    },
    {id, text: css},
  );
}

export async function clearStylesheet(page, id = "theme-lab-live-css") {
  await page.evaluate((styleId) => {
    document.getElementById(styleId)?.remove();
  }, id);
}

// Report actual platform fonts used to paint a DOM node, rather than only the
// CSS font-family stack. This makes Japanese fallback/glyph coverage auditable.
export async function inspectPlatformFonts(page, selector) {
  const requested = await page.evaluate(async (sourceSelector) => {
    const source = document.querySelector(sourceSelector) ?? document.querySelector("#page-content") ?? document.body;
    const computed = getComputedStyle(source);
    const probe = document.createElement("span");
    probe.id = "theme-lab-font-diagnostic-probe";
    probe.textContent = "日本語の字形を確認する検体です。漢字、ひらがな、カタカナ。";
    Object.assign(probe.style, {
      position: "fixed", left: "0", top: "0", zIndex: "-2147483647", opacity: "0",
      display: "inline-block", visibility: "visible", whiteSpace: "nowrap",
      fontFamily: computed.fontFamily, fontSize: computed.fontSize,
      fontWeight: computed.fontWeight, fontStyle: computed.fontStyle,
      lineHeight: computed.lineHeight, letterSpacing: computed.letterSpacing,
    });
    document.body.append(probe);
    await document.fonts.ready;
    return {selector: sourceSelector, requested_font_family: computed.fontFamily};
  }, selector);
  const client = await page.context().newCDPSession(page);
  try {
    await Promise.all([client.send("DOM.enable"), client.send("CSS.enable")]);
    const {root} = await client.send("DOM.getDocument", {depth: -1, pierce: true});
    const {nodeId} = await client.send("DOM.querySelector", {nodeId: root.nodeId, selector: "#theme-lab-font-diagnostic-probe"});
    if (!nodeId) return {status: "selector_missing", ...requested, fonts: []};
    const {fonts} = await client.send("CSS.getPlatformFontsForNode", {nodeId});
    return {
      status: "measured",
      ...requested,
      fonts: fonts.map(({familyName, postScriptName, isCustomFont, glyphCount}) => ({family_name: familyName, postscript_name: postScriptName, custom: isCustomFont, glyph_count: glyphCount})),
    };
  } finally {
    await client.detach().catch(() => {});
    await page.evaluate(() => document.getElementById("theme-lab-font-diagnostic-probe")?.remove()).catch(() => {});
  }
}

export async function inspectBrokenImages(page) {
  await page.evaluate(async () => {
    const images = [...document.images];
    await Promise.all(images.map((image) => {
      // A replaced src can briefly report complete=true for the prior failed
      // resource. Wait for successful decode whenever dimensions are still
      // absent; otherwise a valid locally substituted page attachment is
      // falsely diagnosed as broken before its data URL finishes decoding.
      if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) return Promise.resolve();
      const decoded = typeof image.decode === "function" ? image.decode().catch(() => {}) : Promise.resolve();
      return Promise.race([
        decoded,
        new Promise((resolve) => setTimeout(resolve, 1200)),
      ]);
    }));
  });
  return page.evaluate(() => {
    const images = [...document.images];
    const broken = images.filter((image) => !image.naturalWidth || !image.naturalHeight).map((image) => ({
      src: image.currentSrc || image.src || image.getAttribute("src"),
      alt: image.alt || "",
      selector: image.id ? `img#${CSS.escape(image.id)}` : image.className && typeof image.className === "string"
        ? `img.${image.className.trim().split(/\s+/u).filter(Boolean).slice(0, 3).map((token) => CSS.escape(token)).join(".")}`
        : "img",
      complete: image.complete,
      natural_width: image.naturalWidth,
      natural_height: image.naturalHeight,
    }));
    return {status: broken.length ? "fail" : "pass", image_count: images.length, broken};
  });
}

// Exercise the Wikidot widgets present in the preview and restore their
// original state so the probe cannot leak into viewport screenshots/torture.
export async function exercisePreviewInteractions(page) {
  const widgets = await page.evaluate(async () => {
    const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const tabsets = [...document.querySelectorAll("#page-content .yui-navset")];
    const tabset = tabsets.at(-1);
    const tabs = tabset ? [...tabset.querySelectorAll(".yui-nav li a")] : [];
    let tabResult = {status: "not-applicable", tab_count: tabs.length};
    if (tabs.length > 1) {
      const nav = tabset.querySelector(".yui-nav");
      const originalIndex = [...nav.querySelectorAll("li")].findIndex((item) => item.classList.contains("selected"));
      const targetIndex = originalIndex === 1 ? 0 : 1;
      tabs[targetIndex].click();
      await settle();
      const activeIndex = [...nav.querySelectorAll("li")].findIndex((item) => item.classList.contains("selected"));
      const changed = activeIndex === targetIndex;
      if (originalIndex >= 0 && tabs[originalIndex]) tabs[originalIndex].click();
      await settle();
      const restoredIndex = [...nav.querySelectorAll("li")].findIndex((item) => item.classList.contains("selected"));
      tabResult = {
        status: changed && restoredIndex === originalIndex ? "pass" : "fail",
        tab_count: tabs.length,
        original_index: originalIndex,
        activated_index: activeIndex,
        restored_index: restoredIndex,
      };
    }

    const collapsibles = [...document.querySelectorAll("#page-content .collapsible-block")];
    const collapsible = collapsibles.at(-1);
    let collapsibleResult = {status: collapsible ? "not-tested" : "not-applicable"};
    if (collapsible) {
      const folded = [...collapsible.children].find((child) => child.classList.contains("collapsible-block-folded"));
      const unfolded = [...collapsible.children].find((child) => child.classList.contains("collapsible-block-unfolded"));
      const isFolded = () => Boolean(folded && getComputedStyle(folded).display !== "none");
      const visibleControl = () => [...collapsible.querySelectorAll(".collapsible-block-link")]
        .find((control) => getComputedStyle(control.closest(".collapsible-block-folded, .collapsible-block-unfolded")).display !== "none");
      const link = visibleControl();
      const initiallyFolded = isFolded();
      if (link) {
        link.click();
        await settle();
        const afterClickFolded = isFolded();
        collapsibleResult = {
          status: afterClickFolded !== initiallyFolded ? "pass" : "fail",
          initial: initiallyFolded ? "folded" : "open",
          after_click: afterClickFolded ? "folded" : "open",
        };
        if (afterClickFolded !== initiallyFolded) visibleControl()?.click();
        await settle();
        const restoredFolded = isFolded();
        collapsibleResult.restored = restoredFolded === initiallyFolded;
        if (!collapsibleResult.restored) collapsibleResult.status = "fail";
      }
    }
    const header = document.querySelector("#header");
    const headerPosition = header ? getComputedStyle(header).position : "missing";
    let scrollResult = {status: "not-applicable", position: headerPosition};
    if (header && (headerPosition === "fixed" || headerPosition === "sticky")) {
      const initialTop = header.getBoundingClientRect().top;
      const stickyTop = getComputedStyle(header).top;
      const root = document.documentElement;
      const oldBehavior = root.style.scrollBehavior;
      const body = document.body;
      const oldBodyBehavior = body.style.scrollBehavior;
      const stability = document.createElement("style");
      stability.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }";
      document.head.append(stability);
      root.style.scrollBehavior = "auto";
      body.style.scrollBehavior = "auto";
      window.scrollTo(0, 400);
      await settle();
      const scrolledTop = header.getBoundingClientRect().top;
      window.scrollTo(0, 0);
      await settle();
      stability.remove();
      root.style.scrollBehavior = oldBehavior;
      body.style.scrollBehavior = oldBodyBehavior;
      const expectedStickyTop = Number.parseFloat(stickyTop);
      const positionMatches = headerPosition === "fixed"
        ? Math.abs(scrolledTop - initialTop) <= 4
        : Math.abs(scrolledTop - expectedStickyTop) <= 4 || Math.abs(scrolledTop - initialTop) <= 4;
      scrollResult = {status: positionMatches ? "pass" : "fail", position: headerPosition, sticky_top: stickyTop, initial_top: Math.round(initialTop), scrolled_top: Math.round(scrolledTop)};
    }
    return {tabs: tabResult, collapsible: collapsibleResult, scroll: scrollResult};
  });
  const count = await page.locator("#page-content a[href], #page-content button, #page-content input").count();
  const controls = page.locator("#page-content a[href]:visible, #page-content button:visible, #page-content input:visible");
  const visibleCount = await controls.count();
  let pointerResult = {status: "not-applicable", control_count: count};
  if (visibleCount) {
    let lastError = null;
    for (let index = 0; index < Math.min(visibleCount, 5); index += 1) {
      const control = controls.nth(index);
      try {
        const focusEvidence = await control.evaluate((element) => {
          element.focus({preventScroll: true});
          return {
            focused: document.activeElement === element,
            tag: element.tagName.toLowerCase(),
            href: element.getAttribute("href"),
            tab_index: element.tabIndex,
            active_tag: document.activeElement?.tagName?.toLowerCase() ?? null,
          };
        });
        await control.hover({timeout: 600});
        const hovered = await control.evaluate((element) => element.matches(":hover"));
        if (focusEvidence.focused && hovered) {
          pointerResult = {status: "pass", ...focusEvidence, hovered, control_count: count, visible_control_count: visibleCount, skipped_controls: index};
          break;
        }
        lastError = `control ${index} did not focus and hover`;
      } catch (error) {
        lastError = error.message.slice(0, 180);
      }
    }
    if (pointerResult.status !== "pass") {
      pointerResult = {status: "fail", evidence: lastError, control_count: count, visible_control_count: visibleCount};
    }
    // Restore the probe's transient interaction state after measurement.
    await page.evaluate(() => document.activeElement?.blur?.()).catch(() => {});
    await page.mouse.move(0, 0).catch(() => {});
  }
  return {...widgets, pointer_focus: pointerResult};
}

// Replace only the article content and its inline styles, leaving the page
// chrome (header, side bar, title) untouched. This is the wikitext preview
// equivalent of live CSS injection: no navigation, no save, no cache work.
export async function applyPreview(
  page,
  {body, styles = [], title = null, containerSelector = "#page-content", styleId = "theme-lab-preview-styles"},
) {
  return page.evaluate(
    ({body: html, styles: styleList, title: previewTitle, containerSelector: selector, styleId: id}) => {
      const container = document.querySelector(selector);
      if (!container) throw new Error(`preview container not found: ${selector}`);
      container.innerHTML = html;
      if (previewTitle !== null) {
        const titleElement = document.querySelector("#page-title");
        if (titleElement) titleElement.textContent = previewTitle;
      }
      let element = document.getElementById(id);
      if (!element) {
        element = document.createElement("style");
        element.id = id;
        document.head.appendChild(element);
      }
      element.textContent = styleList.join("\n");
      return {container: selector, body_bytes: html.length, styles: styleList.length};
    },
    {body, styles, title, containerSelector, styleId},
  );
}

export async function collectSelectorMatches(page, selectors) {
  return page.evaluate((list) => {
    const counts = {};
    const errors = {};
    for (const selector of list) {
      try {
        counts[selector] = document.querySelectorAll(selector).length;
      } catch (error) {
        errors[selector] = String(error);
      }
    }
    return {counts, errors};
  }, selectors);
}

export async function collectElements(page, {selector, properties, pseudo = null, max = 25}) {
  return page.evaluate(
    ({selector: query, properties: propertyList, pseudo: pseudoElement, max: limit}) => {
      let elements;
      try {
        elements = [...document.querySelectorAll(query)];
      } catch (error) {
        return {error: String(error), elements: []};
      }
      const collected = elements.slice(0, limit).map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element, pseudoElement ?? null);
        const values = {};
        for (const property of propertyList) {
          values[property] = style.getPropertyValue(property);
        }
        return {
          index,
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          class: typeof element.className === "string" ? element.className : null,
          text: (element.textContent ?? "").trim().slice(0, 80),
          rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
          style: values,
        };
      });
      return {error: null, total: elements.length, elements: collected};
    },
    {selector, properties, pseudo, max},
  );
}

// Collect many selectors in a single round trip. One evaluate per page instead
// of one per selector is the difference between ~1s and ~50ms for a 60-probe
// reference diff.
export async function collectElementsBatch(page, {selectors, properties, pseudo = null, max = 5}) {
  return page.evaluate(
    ({selectors: queryList, properties: propertyList, pseudo: pseudoElement, max: limit}) => {
      const out = {};
      for (const selector of queryList) {
        let elements;
        try {
          elements = [...document.querySelectorAll(selector)];
        } catch (error) {
          out[selector] = {error: String(error), elements: []};
          continue;
        }
        out[selector] = {
          error: null,
          total: elements.length,
          elements: elements.slice(0, limit).map((element, index) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element, pseudoElement ?? null);
            const values = {};
            for (const property of propertyList) {
              values[property] = style.getPropertyValue(property);
            }
            return {
              index,
              tag: element.tagName.toLowerCase(),
              id: element.id || null,
              class: typeof element.className === "string" ? element.className : null,
              text: (element.textContent ?? "").trim().slice(0, 80),
              rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
              style: values,
            };
          }),
        };
      }
      return out;
    },
    {selectors, properties, pseudo, max},
  );
}

// Return every candidate stylesheet declaration that matches the first element
// of `selector` for `property`, plus media queries that would apply at another
// viewport and any CSS variable the computed value depends on.
export async function collectCascadeDeclarations(page, {selector, property}) {
  return page.evaluate(
    ({selector: query, property: targetProperty}) => {
      let elements;
      try {
        elements = [...document.querySelectorAll(query)];
      } catch (error) {
        return {matched: 0, error: String(error)};
      }
      if (elements.length === 0) return {matched: 0};
      const element = elements[0];
      const declarations = [];
      const mediaInactive = [];
      let order = 0;
      const matches = (rule) => {
        try {
          return element.matches(rule.selectorText);
        } catch {
          return false;
        }
      };
      const visit = (rules, media) => {
        for (const rule of rules) {
          if (rule.type === CSSRule.MEDIA_RULE) {
            if (window.matchMedia(rule.conditionText).matches) {
              visit(rule.cssRules, rule.conditionText);
            } else {
              for (const inner of rule.cssRules) {
                if (inner.type === CSSRule.STYLE_RULE && inner.selectorText && matches(inner)) {
                  const value = inner.style.getPropertyValue(targetProperty);
                  if (value) {
                    mediaInactive.push({
                      condition: rule.conditionText,
                      selector: inner.selectorText,
                      value,
                      important: inner.style.getPropertyPriority(targetProperty) === "important",
                    });
                  }
                }
              }
            }
            continue;
          }
          if (rule.type === CSSRule.SUPPORTS_RULE) {
            visit(rule.cssRules, media);
            continue;
          }
          if (rule.type !== CSSRule.STYLE_RULE || !rule.selectorText) continue;
          if (!matches(rule)) continue;
          const value = rule.style.getPropertyValue(targetProperty);
          if (!value) continue;
          declarations.push({
            selector: rule.selectorText,
            value,
            important: rule.style.getPropertyPriority(targetProperty) === "important",
            media,
            order: order++,
          });
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          visit(sheet.cssRules, null);
        } catch {
          // cross-origin stylesheet; skip
        }
      }
      const computed = getComputedStyle(element);
      const computedValue = computed.getPropertyValue(targetProperty);
      let variables = null;
      const variableMatch = computedValue.match(/var\(\s*(--[\w-]+)/u);
      if (variableMatch) {
        const name = variableMatch[1];
        const value = computed.getPropertyValue(name);
        variables = {name, value, defined: value.trim().length > 0};
      }
      return {
        matched: elements.length,
        inline: element.style.getPropertyValue(targetProperty) || null,
        computed_value: computedValue,
        declarations,
        media_inactive: mediaInactive,
        variables,
      };
    },
    {selector, property},
  );
}

// Collect one representative element per semantic anchor selector, grouped by
// role, in a single round trip.
export async function collectSemanticAnchorElements(page, {anchors, max = 1}) {
  const selectors = anchors.flatMap((anchor) => anchor.selectors);
  const batch = await collectElementsBatch(page, {
    selectors,
    properties: ["display", "visibility", "width", "height"],
    max,
  });
  const byRole = {};
  for (const anchor of anchors) {
    const elements = [];
    for (const selector of anchor.selectors) {
      const result = batch[selector];
      if (!result?.elements?.length) continue;
      for (const element of result.elements.slice(0, max)) {
        elements.push({...element, selector});
      }
    }
    if (elements.length > 0) byRole[anchor.role] = elements;
  }
  return byRole;
}

// Enumerate every stylesheet. Same-origin sheets expose `cssRules`; cross-origin
// sheets are returned with their href so the caller can fetch and parse them.
export async function collectStyleSheetRules(page) {
  const sheets = await page.evaluate(() => {
    const result = [];
    for (const sheet of document.styleSheets) {
      const entry = {href: sheet.href ?? null, rules: null, cross_origin: false};
      try {
        entry.rules = [...sheet.cssRules].map((rule) => ({
          selector_text: rule.selectorText ?? null,
          css_text: rule.cssText,
        }));
      } catch {
        entry.cross_origin = true;
      }
      result.push(entry);
    }
    return result;
  });

  const rules = [];
  for (const sheet of sheets) {
    if (Array.isArray(sheet.rules)) {
      for (const rule of sheet.rules) {
        if (rule.selector_text) {
          rules.push({selector: rule.selector_text, atContext: [], prelude: rule.selector_text, source: sheet.href});
        }
      }
      continue;
    }
    if (sheet.cross_origin && sheet.href) {
      const text = await fetchStyleSheetText(page, sheet.href);
      if (text) {
        for (const rule of parseStyleSheet(text)) rules.push({...rule, source: sheet.href});
      }
    }
  }
  return rules;
}

export async function fetchStyleSheetText(page, href) {
  try {
    const response = await page.request.get(href, {timeout: 15_000});
    if (!response.ok()) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export async function collectSnapshot(page, {selectors, properties, max = 25}) {
  const rules = await collectStyleSheetRules(page);
  const {counts, errors} = await collectSelectorMatches(page, selectors);
  const elements = {};
  for (const selector of selectors) {
    elements[selector] = await collectElements(page, {selector, properties, max});
  }
  return {
    url: page.url(),
    rules,
    selector_counts: counts,
    selector_errors: errors,
    elements,
  };
}

// Snapshot the original article content so destructive operations (torture,
// preview) can be undone without a page reload.
export async function capturePristineContent(
  page,
  {containerSelector = "#page-content", styleId = "theme-lab-preview-styles"} = {},
) {
  return page.evaluate(
    ({containerSelector: selector, styleId: id}) => {
      const container = document.querySelector(selector);
      return {
        container: selector,
        html: container ? container.innerHTML : null,
        title_html: document.querySelector("#page-title")?.innerHTML ?? null,
        preview_styles: document.getElementById(id)?.textContent ?? null,
      };
    },
    {containerSelector, styleId},
  );
}

export async function restorePristineContent(
  page,
  pristine,
  {containerSelector = "#page-content", styleId = "theme-lab-preview-styles"} = {},
) {
  if (!pristine || pristine.html === null) return false;
  await page.evaluate(
    ({html, titleHtml, previewStyles, containerSelector: selector, styleId: id}) => {
      const container = document.querySelector(selector);
      if (container) container.innerHTML = html;
      const title = document.querySelector("#page-title");
      if (title && titleHtml !== null) title.innerHTML = titleHtml;
      let element = document.getElementById(id);
      if (previewStyles === null) {
        element?.remove();
        return;
      }
      if (!element) {
        element = document.createElement("style");
        element.id = id;
        document.head.appendChild(element);
      }
      element.textContent = previewStyles;
    },
    {html: pristine.html, titleHtml: pristine.title_html, previewStyles: pristine.preview_styles, containerSelector, styleId},
  );
  return true;
}

// Cheap four-viewport overflow guard that does not need the torture fixture.
export async function collectViewportOverflow(page, viewports) {
  const result = {};
  for (const viewport of viewports) {
    await setViewport(page, viewport);
    result[viewport.id] = await page.evaluate(() => {
      const stabilityStyle = document.createElement("style");
      stabilityStyle.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }";
      document.head.appendChild(stabilityStyle);
      void getComputedStyle(document.body).width;
      const root = document.documentElement;
      const content = document.querySelector("#page-content");
      const offenders = [];
      const keepTopFive = (row) => {
        let index = 0;
        while (index < offenders.length && offenders[index].overflow_px >= row.overflow_px) index += 1;
        offenders.splice(index, 0, row);
        if (offenders.length > 5) offenders.pop();
      };
      const stack = [...document.body.children].reverse().map((element) => ({element, clippingRight: null}));
      while (stack.length) {
        const {element, clippingRight} = stack.pop();
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const overflowPx = Math.max(0, rect.right - root.clientWidth);
        const clipped = clippingRight !== null && rect.right > clippingRight + 2;
        if (overflowPx > 0.5 && !clipped) keepTopFive({element, rect, style, overflow_px: overflowPx});
        let childClippingRight = clippingRight;
        if (
          ["auto", "scroll", "hidden", "clip"].includes(style.overflowX) &&
          rect.right <= root.clientWidth + 2
        ) {
          childClippingRight = childClippingRight === null ? rect.right : Math.min(childClippingRight, rect.right);
        }
        const children = element.children;
        for (let index = children.length - 1; index >= 0; index -= 1) {
          stack.push({element: children[index], clippingRight: childClippingRight});
        }
      }
      const overflowSources = offenders
        .map(({element, rect, overflow_px}) => {
          const style = getComputedStyle(element);
          const selector = element.id ? `#${CSS.escape(element.id)}` :
            `${element.tagName.toLowerCase()}${[...element.classList].slice(0, 3).map((name) => `.${CSS.escape(name)}`).join("")}`;
          const ancestors = [];
          let parent = element.parentElement;
          while (parent && ancestors.length < 5) {
            const name = parent.id ? `#${CSS.escape(parent.id)}` :
              `${parent.tagName.toLowerCase()}${[...parent.classList].slice(0, 2).map((part) => `.${CSS.escape(part)}`).join("")}`;
            ancestors.push(name);
            parent = parent.parentElement;
          }
          return {
            selector,
            tag: element.tagName.toLowerCase(),
            class_name: typeof element.className === "string" ? element.className.slice(0, 120) : "",
            inside_page_content: Boolean(content?.contains(element)),
            ancestors,
            rect: {left: Math.round(rect.left * 10) / 10, right: Math.round(rect.right * 10) / 10, width: Math.round(rect.width * 10) / 10},
            overflow_px: Math.round(overflow_px * 10) / 10,
            computed: {width: style.width, min_width: style.minWidth, max_width: style.maxWidth, position: style.position, overflow_x: style.overflowX},
          };
        });
      const measurement = {
        document_overflow_px: Math.max(0, root.scrollWidth - root.clientWidth),
        content_overflow_px: content ? Math.max(0, content.scrollWidth - content.clientWidth) : null,
        overflow_sources: overflowSources,
      };
      stabilityStyle.remove();
      return measurement;
    });
  }
  return result;
}

export async function screenshot(page, {path: outputPath, fullPage = true, viewport = null}) {
  if (viewport) await page.setViewportSize(viewport);
  await resetScrollPosition(page);
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "theme-lab-screenshot-stability";
    style.textContent = "*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }";
    document.head.appendChild(style);
    void getComputedStyle(document.body).width;
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    await page.screenshot({path: outputPath, fullPage});
  } finally {
    await page.evaluate(() => document.getElementById("theme-lab-screenshot-stability")?.remove());
  }
  return outputPath;
}

async function resetScrollPosition(page) {
  await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const rootBehavior = root.style.scrollBehavior;
    const bodyBehavior = body.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    body.style.scrollBehavior = "auto";
    root.scrollLeft = 0;
    root.scrollTop = 0;
    body.scrollLeft = 0;
    body.scrollTop = 0;
    for (const element of document.querySelectorAll("*")) {
      if (element.scrollLeft) element.scrollLeft = 0;
      if (element.scrollTop) element.scrollTop = 0;
    }
    window.scrollTo(0, 0);
    void root.offsetWidth;
    root.style.scrollBehavior = rootBehavior;
    body.style.scrollBehavior = bodyBehavior;
  });
}

export async function setViewport(page, viewport) {
  await page.setViewportSize(viewport);
  await resetScrollPosition(page);
}
