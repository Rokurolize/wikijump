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
