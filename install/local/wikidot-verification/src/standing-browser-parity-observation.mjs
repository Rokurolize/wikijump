import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { STANDING_BROWSER_CAPTURE_SCHEMA } from "./standing-browser-parity-contract.mjs";
import { domSignature } from "./oracle-fixtures.mjs";
import {
  applyCssBoxFallback,
  capturePseudoLayouts,
} from "./standing-browser-pseudo-layout.mjs";
import { capturePng } from "./standing-browser-screenshot.mjs";
import { sha256File } from "./standing-browser-parity-util.mjs";

function failureKey(failure) {
  return JSON.stringify([
    failure?.kind ?? null,
    failure?.url ?? null,
    failure?.status ?? null,
    failure?.resource_type ?? null,
    failure?.error ?? null,
  ]);
}

function artifactBase({ label, index, url }) {
  const digest = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return `standing-browser-${label}-${String(index).padStart(2, "0")}-${digest}`;
}

export function observationArtifactName({ label, index, url, phase }) {
  if (
    !new Set([
      "domcontentloaded-immediate",
      "settled-viewport",
      "settled-full-page",
    ]).has(phase)
  ) {
    throw new Error(`unsupported browser observation artifact phase: ${phase}`);
  }
  return `${artifactBase({ label, index, url })}-${phase}.png`;
}

export async function captureDocumentObservation(
  page,
  { contract, phase, viewport },
) {
  const geometrySelectors =
    phase === "domcontentloaded_immediate_observation"
      ? (contract?.first_paint_geometry_selectors ?? [])
      : (contract?.geometry_selectors ?? []);
  const presenceProbes = contract?.presence_probes ?? [];
  const customPropertyNames = Object.keys(
    contract?.first_paint_custom_properties ?? {},
  ).sort();
  // Synthetic callers may intentionally use a smaller contract.  The
  // standing canary contract carries PAGE_CHROME_SKELETON explicitly; do not
  // silently add it to every ad-hoc observation and turn an unrelated
  // contract into a page-chrome assertion.
  const skeleton = contract?.page_chrome_skeleton ?? null;
  const documentPhase = await page.evaluate(
    ({
      geometrySelectors: selectors,
      presenceProbes: probes,
      customPropertyNames: properties,
      skeletonContract,
      phase: capturedPhase,
    }) => {
      const rounded = (value) => Math.round(Number(value) * 100) / 100;
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return Object.fromEntries(
          ["x", "y", "width", "height"].map((key) => [key, rounded(box[key])]),
        );
      };
      const rendered = (element) => {
        // Chromium may report non-zero descendant boxes for closed details.
        // Only the direct summary subtree participates in rendered parity.
        for (
          let details = element.parentElement?.closest?.(
            "details:not([open])",
          );
          details;
          details = details.parentElement?.closest?.("details:not([open])")
        ) {
          const summary = [...details.children].find(
            (child) => child.localName === "summary",
          );
          if (!summary || (element !== summary && !summary.contains(element))) {
            return false;
          }
        }
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0 &&
          box.width > 0 &&
          box.height > 0
        );
      };
      const normalized = (value) =>
        String(value ?? "")
          .trim()
          .replace(/\s+/gu, " ");
      const pseudoRendered = (element, pseudo) => {
        const style = getComputedStyle(element, pseudo);
        const content = normalized(style.content).replace(
          /^(?:["'])|(?:["'])$/gu,
          "",
        );
        const paintsContent =
          content !== "" && content !== "none" && content !== "normal";
        const paintsBackground = normalized(style.backgroundImage) !== "none";
        return (
          rendered(element) &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0 &&
          (paintsContent || paintsBackground)
        );
      };
      const geometry = Object.fromEntries(
        selectors.map((selector) => {
          const nodes = [...document.querySelectorAll(selector)];
          return [
            selector,
            {
              count: nodes.length,
              rect: nodes.length === 1 ? rect(nodes[0]) : null,
            },
          ];
        }),
      );
      const observedProbes = probes.map((probe) => {
        const nodes = [...document.querySelectorAll(probe.selector)];
        const element = nodes.length === 1 ? nodes[0] : null;
        const style = element
          ? getComputedStyle(element, probe.pseudo ?? null)
          : null;
        return {
          id: probe.id,
          selector: probe.selector,
          pseudo: probe.pseudo ?? null,
          count: nodes.length,
          rendered_count: nodes.filter((candidate) =>
            probe.pseudo
              ? pseudoRendered(candidate, probe.pseudo)
              : rendered(candidate),
          ).length,
          rect: element ? rect(element) : null,
          style: style
            ? Object.fromEntries(
                (probe.comparison_properties ?? []).map((property) => [
                  property,
                  normalized(style.getPropertyValue(property)),
                ]),
              )
            : null,
        };
      });
      const root = document.querySelector("#page-content");
      const images = [...document.images].filter(rendered);
      const pageChromeSkeleton = {
        schema: skeletonContract?.schema ?? null,
        links: (skeletonContract?.links ?? []).map((link) => {
          const parentNodes =
            link.parent === "body"
              ? document.body
                ? [document.body]
                : []
              : [...document.querySelectorAll(link.parent)];
          const childNodes = [...document.querySelectorAll(link.child)];
          const directChildCount = parentNodes.reduce(
            (count, parent) =>
              count +
              [...(parent.children ?? [])].filter((child) =>
                child.matches(link.child),
              ).length,
            0,
          );
          return {
            parent: link.parent,
            child: link.child,
            parent_count: parentNodes.length,
            child_count: childNodes.length,
            direct_child_count: directChildCount,
          };
        }),
      };
      const pageContentElements = root
        ? [...root.querySelectorAll("*")]
        : [];
      return {
        phase: capturedPhase,
        captured_at_epoch_ms: Date.now(),
        captured_at_performance_ms: rounded(performance.now()),
        ready_state: document.readyState,
        geometry,
        presence_probes: observedProbes,
        custom_properties: Object.fromEntries(
          properties.map((property) => [
            property,
            normalized(
              getComputedStyle(document.documentElement).getPropertyValue(
                property,
              ),
            ),
          ]),
        ),
        dom_signatures: root
          ? pageContentElements
              .filter(rendered)
              .map(
                (element) =>
                  `${element.localName}${element.id ? `#${element.id}` : ""}${[
                    ...element.classList,
                  ]
                    .sort()
                    .map((name) => `.${name}`)
                    .join("")}`,
              )
            .sort()
          : [],
        page_content_html: root?.innerHTML ?? null,
        attribute_signatures: pageContentElements
          .filter(rendered)
          .flatMap((element) =>
            [...(element.attributes ?? [])].map((attribute) => ({
              tag: element.localName,
              name: attribute.name,
              value: attribute.value,
            })),
          )
          .sort((left, right) =>
            JSON.stringify(left).localeCompare(JSON.stringify(right)),
          ),
        rendered_images: images.length,
        broken_images: images
          .filter((image) => !image.complete || image.naturalWidth <= 0)
          .map((image) => ({
            src: image.currentSrc || image.src,
            natural_width: image.naturalWidth,
            natural_height: image.naturalHeight,
          })),
        page_chrome_skeleton: pageChromeSkeleton,
      };
    },
    {
      geometrySelectors,
      presenceProbes,
      customPropertyNames,
      skeletonContract: skeleton,
      phase,
    },
  );
  if (typeof documentPhase.page_content_html === "string") {
    documentPhase.dom_signature = domSignature(documentPhase.page_content_html);
  } else {
    documentPhase.dom_signature = null;
  }
  delete documentPhase.page_content_html;
  const pseudoLayouts = await capturePseudoLayouts(
    page,
    presenceProbes,
    viewport,
  );
  const requirements = new Map(
    presenceProbes.map((probe) => [probe.id, probe]),
  );
  for (const probe of documentPhase.presence_probes) {
    if (!probe.pseudo) continue;
    const requirement = requirements.get(probe.id);
    const layout = pseudoLayouts[probe.id] ?? {
      status: "capture_error",
      error: "pseudo layout was not returned",
    };
    probe.pseudo_layout = requirement?.pseudo_layout?.allow_css_box_fallback
      ? applyCssBoxFallback(layout, probe.rect, probe.style)
      : layout;
  }
  return documentPhase;
}

async function capturedScreenshot(filePath, fullPage) {
  if (!filePath) return null;
  const stat = await fs.lstat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) return null;
  return {
    path: path.basename(filePath),
    sha256: await sha256File(filePath),
    full_page: fullPage,
  };
}

async function waitForSettledResources(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const remaining = (label) => {
    const value = deadline - Date.now();
    if (value <= 0) throw new Error(`${label} exceeded the capture timeout`);
    return value;
  };
  let loadStatus = "complete";
  try {
    await page.waitForLoadState("load", {
      timeout: remaining("load completion"),
    });
  } catch (error) {
    if (error?.name !== "TimeoutError") throw error;
    // Free Wikidot themes keep third-party frames and resources pending.  A
    // browser-visible oracle still needs its bounded settled DOM and receipt;
    // record the load boundary instead of silently returning an incomplete
    // capture or waiting without a deadline.
    loadStatus = "bounded_domcontentloaded";
  }
  if (loadStatus === "bounded_domcontentloaded") {
    return await page.evaluate((limit) => ({
      status: "bounded_domcontentloaded",
      load_ready_state: document.readyState,
      font_status: document.fonts?.status ?? "not_supported",
      image_count: document.images.length,
      incomplete_image_count: [...document.images].filter(
        (image) => !image.complete,
      ).length,
      load_timeout_ms: limit,
      pending_image_urls: [...document.images]
        .filter((image) => !image.complete)
        .map((image) => image.currentSrc || image.src)
        .sort(),
    }));
  }
  return await page.evaluate(async (limit) => {
    const waitForImage = (image) => {
      if (image.complete) return Promise.resolve();
      return new Promise((resolve) => {
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          image.removeEventListener("load", finish);
          image.removeEventListener("error", finish);
          resolve();
        };
        image.addEventListener("load", finish, { once: true });
        image.addEventListener("error", finish, { once: true });
        if (image.complete) finish();
      });
    };
    let timeout = null;
    try {
      await Promise.race([
        Promise.all([
          Promise.resolve(document.fonts?.ready),
          ...[...document.images].map(waitForImage),
        ]),
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("font or image completion timed out")),
            limit,
          );
        }),
      ]);
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
    const incompleteImages = [...document.images].filter(
      (image) => !image.complete,
    );
    if (incompleteImages.length > 0) {
      throw new Error("image completion remained incomplete after load");
    }
    return {
      status: "complete",
      load_ready_state: document.readyState,
      font_status: document.fonts?.status ?? "not_supported",
      image_count: document.images.length,
      incomplete_image_count: incompleteImages.length,
    };
  }, remaining("font and image completion"));
}

export async function captureBrowserParityObservation({
  context,
  page: suppliedPage = null,
  url,
  label,
  index,
  outputDir,
  contract,
  viewport,
  timeoutMs,
  settleMs,
}) {
  const page = suppliedPage ?? (await context.newPage());
  const ownsPage = suppliedPage === null;
  const failures = [];
  const onRequestFailed = (request) => {
    failures.push({
      kind: "request_failed",
      url: request.url(),
      resource_type: request.resourceType(),
      error: request.failure()?.errorText ?? "request failed",
    });
  };
  const onResponse = (response) => {
    if (response.status() >= 400) {
      failures.push({
        kind: "http_error",
        url: response.url(),
        resource_type: response.request().resourceType(),
        status: response.status(),
      });
    }
  };
  page.on("requestfailed", onRequestFailed);
  page.on("response", onResponse);
  const capturedAt = new Date().toISOString();
  let response = null;
  let firstDocument = null;
  let document = null;
  const firstPath = path.join(
    outputDir,
    observationArtifactName({
      label,
      index,
      url,
      phase: "domcontentloaded-immediate",
    }),
  );
  const viewportPath = path.join(
    outputDir,
    observationArtifactName({ label, index, url, phase: "settled-viewport" }),
  );
  const fullPagePath = path.join(
    outputDir,
    observationArtifactName({ label, index, url, phase: "settled-full-page" }),
  );
  try {
    response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    // This is a deterministic immediate DOMContentLoaded observation, not a
    // compositor-filmstrip sample. Keep document and screenshot collection
    // sequential so the receipt records one unambiguous observation order.
    firstDocument = await captureDocumentObservation(page, {
      contract,
      phase: "domcontentloaded_immediate_observation",
      viewport,
    });
    await capturePng(page, firstPath);
    const resourceCompletion = await waitForSettledResources(page, timeoutMs);
    if (settleMs > 0) await page.waitForTimeout(settleMs);
    document = await captureDocumentObservation(page, {
      contract,
      phase: "settled",
      viewport,
    });
    document.resource_completion = resourceCompletion;
    await capturePng(page, viewportPath);
    await capturePng(page, fullPagePath, { fullPage: true });
    failures.sort((left, right) =>
      failureKey(left).localeCompare(failureKey(right)),
    );
    return {
      schema: STANDING_BROWSER_CAPTURE_SCHEMA,
      captured_at: capturedAt,
      input_url: url,
      final_url: page.url(),
      navigation_status: response?.status() ?? 0,
      canary: contract
        ? { slug: contract.slug, theme_family: contract.theme_family }
        : null,
      failures,
      first_paint: {
        document: firstDocument,
        screenshot: await capturedScreenshot(firstPath, false),
      },
      document,
      geometry: document.geometry,
      page_chrome_skeleton: document.page_chrome_skeleton,
      dom_signature: document.dom_signature,
      attribute_signatures: document.attribute_signatures,
      dom_signatures: document.dom_signatures,
      rendered_images: document.rendered_images,
      broken_images: document.broken_images,
      settled_viewport_screenshot: await capturedScreenshot(
        viewportPath,
        false,
      ),
      screenshot: await capturedScreenshot(fullPagePath, true),
    };
  } catch (error) {
    const partial = document ?? {
      geometry: {},
      presence_probes: [],
      custom_properties: {},
      dom_signatures: [],
      page_chrome_skeleton: null,
      dom_signature: null,
      attribute_signatures: [],
      rendered_images: 0,
      broken_images: [],
    };
    failures.sort((left, right) =>
      failureKey(left).localeCompare(failureKey(right)),
    );
    return {
      schema: STANDING_BROWSER_CAPTURE_SCHEMA,
      captured_at: capturedAt,
      input_url: url,
      final_url: page.url() || null,
      navigation_status: response?.status() ?? 0,
      canary: contract
        ? { slug: contract.slug, theme_family: contract.theme_family }
        : null,
      failures,
      first_paint:
        firstDocument || (await capturedScreenshot(firstPath, false))
          ? {
              document: firstDocument,
              screenshot: await capturedScreenshot(firstPath, false),
            }
          : null,
      document: partial,
      geometry: partial.geometry,
      dom_signatures: partial.dom_signatures,
      page_chrome_skeleton: partial.page_chrome_skeleton,
      dom_signature: partial.dom_signature,
      attribute_signatures: partial.attribute_signatures,
      rendered_images: partial.rendered_images,
      broken_images: partial.broken_images,
      settled_viewport_screenshot: await capturedScreenshot(
        viewportPath,
        false,
      ),
      screenshot: await capturedScreenshot(fullPagePath, true),
      capture_error: { name: error.name, message: error.message },
    };
  } finally {
    page.off("requestfailed", onRequestFailed);
    page.off("response", onResponse);
    if (ownsPage) {
      await page.close({runBeforeUnload: false, timeout: 10_000}).catch(() => undefined);
    }
  }
}
