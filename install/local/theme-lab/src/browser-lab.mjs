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

export async function openPage(browser, {url = "about:blank", viewport = null, ignoreHttpsErrors = true} = {}) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: ignoreHttpsErrors,
    ...(viewport ? {viewport} : {}),
  });
  const page = await context.newPage();
  page.__themeLabContext = context;
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

// Replace only the article content and its inline styles, leaving the page
// chrome (header, side bar, title) untouched. This is the wikitext preview
// equivalent of live CSS injection: no navigation, no save, no cache work.
export async function applyPreview(
  page,
  {body, styles = [], containerSelector = "#page-content", styleId = "theme-lab-preview-styles"},
) {
  return page.evaluate(
    ({body: html, styles: styleList, containerSelector: selector, styleId: id}) => {
      const container = document.querySelector(selector);
      if (!container) throw new Error(`preview container not found: ${selector}`);
      container.innerHTML = html;
      let element = document.getElementById(id);
      if (!element) {
        element = document.createElement("style");
        element.id = id;
        document.head.appendChild(element);
      }
      element.textContent = styleList.join("\n");
      return {container: selector, body_bytes: html.length, styles: styleList.length};
    },
    {body, styles, containerSelector, styleId},
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
    ({html, previewStyles, containerSelector: selector, styleId: id}) => {
      const container = document.querySelector(selector);
      if (container) container.innerHTML = html;
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
    {html: pristine.html, previewStyles: pristine.preview_styles, containerSelector, styleId},
  );
  return true;
}

// Cheap four-viewport overflow guard that does not need the torture fixture.
export async function collectViewportOverflow(page, viewports) {
  const result = {};
  for (const viewport of viewports) {
    await setViewport(page, viewport);
    result[viewport.id] = await page.evaluate(() => {
      const root = document.documentElement;
      const content = document.querySelector("#page-content");
      return {
        document_overflow_px: Math.max(0, root.scrollWidth - root.clientWidth),
        content_overflow_px: content ? Math.max(0, content.scrollWidth - content.clientWidth) : null,
      };
    });
  }
  return result;
}

export async function screenshot(page, {path: outputPath, fullPage = true, viewport = null}) {
  if (viewport) await page.setViewportSize(viewport);
  await page.screenshot({path: outputPath, fullPage});
  return outputPath;
}

export async function setViewport(page, viewport) {
  await page.setViewportSize(viewport);
}
