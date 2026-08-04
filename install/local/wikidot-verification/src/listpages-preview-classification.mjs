import fs from "node:fs/promises";

import {
  canonicalDom,
  sha256,
  validateWikidotReference,
  visibleText,
} from "./syntax-differential.mjs";
import {
  compareListPagesPreviewHtml,
  LISTPAGES_PREVIEW_DIFFERENTIAL_SCHEMA,
  validateListPagesRuntimeIdentity,
  validateListPagesRuntimeProof,
} from "./listpages-preview-differential.mjs";
import {
  extractListPagesInvocationsFromSource,
} from "./listpages-campaign-inventory.mjs";
import {
  publishListPagesJsonNoReplace,
} from "./listpages-evidence-publication.mjs";
import {
  observeListPagesRuntimeAuthority,
  validateListPagesRuntimeObservation,
} from "./listpages-runtime-authority.mjs";
import {
  compareTabviewSafetyPreservation,
} from "./generic-runtime-differential.mjs";

export const LISTPAGES_PREVIEW_CLASSIFICATION_SCHEMA =
  "wikijump_listpages_compat.preview_classification.v1";

function readJsonlText(text) {
  if (!text.trim()) return [];
  return text.trimEnd().split(/\r?\n/u).map((line) => JSON.parse(line));
}

function domHasClass(nodes, className) {
  for (const node of nodes ?? []) {
    const classes = node.attrs
      ?.find((attribute) => attribute.name === "class")
      ?.value.split(/\s+/u) ?? [];
    if (classes.includes(className) || domHasClass(node.children, className)) {
      return true;
    }
  }
  return false;
}

function localDom(row) {
  if (row.comparison?.checks?.dom_tree?.status === "mismatch") {
    return row.comparison.checks.dom_tree.local;
  }
  return null;
}

function literalContextKeepsListPagesInactive({
  row,
  reference,
  localNodes,
  localUnsupportedDiagnostic,
}) {
  if (!row.case_id.endsWith(":literal-context")) return false;
  const liveNodes = canonicalDom(reference.raw_html);
  const liveExecuted = ["list-pages-box", "list-pages-item", "pager"]
    .some((className) => domHasClass(liveNodes, className));
  const localExecuted = ["list-pages-box", "list-pages-item", "pager"]
    .some((className) => domHasClass(localNodes, className));
  return !liveExecuted && !localExecuted && !localUnsupportedDiagnostic;
}

function outermostListPagesOwnedSubtrees(nodes) {
  const output = [];
  const ownedClasses = new Set([
    "list-pages-box",
    "list-pages-item",
    "pager",
  ]);
  const visit = (node) => {
    if (node?.type !== "element") return;
    const classes = node.attrs
      ?.find((attribute) => attribute.name === "class")
      ?.value.split(/\s+/u) ?? [];
    if (classes.some((className) => ownedClasses.has(className))) {
      output.push(node);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of nodes ?? []) visit(node);
  return output;
}

function literalContextHasExactListPagesExecution({
  row,
  liveNodes,
  localNodes,
  localUnsupportedDiagnostic,
}) {
  if (
    !row.case_id.endsWith(":literal-context") ||
    localUnsupportedDiagnostic
  ) {
    return false;
  }
  const liveOwned = outermostListPagesOwnedSubtrees(liveNodes);
  const localOwned = outermostListPagesOwnedSubtrees(localNodes);
  return liveOwned.length > 0 &&
    JSON.stringify(liveOwned) === JSON.stringify(localOwned);
}

function asciiCaseInsensitiveOccurrenceCount(text, needle) {
  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  let count = 0;
  let cursor = 0;
  while (target.length > 0) {
    const next = haystack.indexOf(target, cursor);
    if (next < 0) break;
    count += 1;
    cursor = next + target.length;
  }
  return count;
}

function literalDocumentationKeepsListPagesInactive({
  source,
  liveText,
  localText,
  liveNodes,
  localNodes,
  localUnsupportedDiagnostic,
}) {
  const stickyDocumentation =
    /^\[\[module[ \t]+listpages\]\]@@\r?\n@@\[\[div\b/iu.test(source);
  const inlineDocumentation =
    /^\[\[module[ \t]+listpages\]\](?:\}\}|@@\}\}|@@[^\r\n]{0,64}@@\[\[html\]\])/iu
      .test(source);
  if (
    localUnsupportedDiagnostic ||
    (!stickyDocumentation && !inlineDocumentation) ||
    (stickyDocumentation && liveText !== localText)
  ) {
    return false;
  }
  const ownedClasses = ["list-pages-box", "list-pages-item", "pager"];
  if (
    ownedClasses.some((className) =>
      domHasClass(liveNodes, className) || domHasClass(localNodes, className)
    )
  ) {
    return false;
  }
  const openings =
    source.match(/\[\[module[ \t]+listpages(?:[ \t][^\r\n\]]*)?\]\]/giu) ??
      [];
  if (openings.length === 0) return false;
  const openingCounts = new Map();
  for (const opening of openings) {
    const key = opening.toLowerCase();
    openingCounts.set(key, (openingCounts.get(key) ?? 0) + 1);
  }
  return [...openingCounts].every(([opening, count]) =>
    asciiCaseInsensitiveOccurrenceCount(liveText, opening) >= count &&
    asciiCaseInsensitiveOccurrenceCount(localText, opening) >= count
  );
}

function hasExactListPagesOwnedExecution({
  liveNodes,
  localNodes,
  localUnsupportedDiagnostic,
}) {
  if (localUnsupportedDiagnostic) return false;
  const liveOwned = outermostListPagesOwnedSubtrees(liveNodes);
  const localOwned = outermostListPagesOwnedSubtrees(localNodes);
  return liveOwned.length > 0 &&
    JSON.stringify(liveOwned) === JSON.stringify(localOwned);
}

function nodeAttribute(node, name) {
  return node?.attrs?.find((attribute) => attribute.name === name)?.value ?? null;
}

function nodeText(node) {
  if (node?.type === "text") return node.value;
  if (node?.type !== "element") return "";
  return (node.children ?? []).map(nodeText).join("");
}

function descendantElements(node, predicate) {
  const output = [];
  const visit = (current) => {
    if (current?.type !== "element") return;
    if (predicate(current)) output.push(current);
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return output;
}

function featuredSiteBoxHasCanonicalStructure(node) {
  if (!nodeHasClass(node, "featured-site-box")) return false;
  const exactlyOne = (className) => {
    const matches = descendantElements(
      node,
      (candidate) => nodeHasClass(candidate, className),
    );
    return matches.length === 1 ? matches[0] : null;
  };
  const container = exactlyOne("container");
  const hovertipContainer = exactlyOne("hovertip-container");
  const hovertip = exactlyOne("featured-site-hovertip");
  const thumbnail = exactlyOne("thumbnail");
  const description = exactlyOne("description");
  const name = exactlyOne("name");
  const stats = exactlyOne("stats");
  const taglines = descendantElements(
    node,
    (candidate) => nodeHasClass(candidate, "tagline"),
  );
  if (
    !container ||
    !hovertipContainer ||
    !hovertip ||
    !thumbnail ||
    !description ||
    !name ||
    !stats ||
    taglines.length > 1 ||
    nodeAttribute(hovertipContainer, "id") !== "special9387424" ||
    nodeAttribute(hovertipContainer, "style") !== "display: none"
  ) {
    return false;
  }
  const links = descendantElements(container, (candidate) =>
    candidate.name === "a"
  );
  const images = descendantElements(container, (candidate) =>
    candidate.name === "img"
  );
  const href = links.length === 1 ? nodeAttribute(links[0], "href") : null;
  const imageId = images.length === 1 ? nodeAttribute(images[0], "id") : null;
  const imageSource = images.length === 1
    ? nodeAttribute(images[0], "src")
    : null;
  const thumbnailSource = nodeAttribute(thumbnail, "src");
  const statsText = nodeText(stats).replace(/\s+/gu, " ").trim();
  return (
    /^http:\/\/[^/]+\.wikidot\.com$/u.test(href ?? "") &&
    /^featured-site-image-[0-9]+$/u.test(imageId ?? "") &&
    /^(?:http:\/\/thumbnails\.wdfiles\.com|https:\/\/thumbnails\.files\.invalid)\/thumbnail\/site\/[^/]+\.wikidot\.com\/160\.jpg$/u
      .test(imageSource ?? "") &&
    imageSource === thumbnailSource &&
    nodeText(name).trim().length > 0 &&
    /^Contributions last month: 0\s*Contributors: 1$/u.test(statsText)
  );
}

const WIKIDOT_SOCIAL_SELECTED_TITLES = ["Reddit", "Facebook"];
const WIKIDOT_SOCIAL_DEFAULT_TITLES = [
  "BlinkList",
  "blogmarks",
  "del.icio.us",
  "digg",
  "Fark",
  "feedmelinks",
  "Furl",
  "LinkaGoGo",
  "NewsVine",
  "Netvouz",
  "Reddit",
  "YahooMyWeb",
  "Facebook",
];

function wikidotSocialSpanNonce(node) {
  if (node?.name !== "span") return null;
  const nonce = nodeAttribute(node, "id");
  if (!/^social[0-9]{1,5}$/u.test(nonce ?? "")) return null;
  const links = (node.children ?? []).filter((child) =>
    child.type === "element" && child.name === "a"
  );
  if (
    links.length !== (node.children ?? [])
      .filter((child) => child.type === "element").length
  ) {
    return null;
  }
  const titles = links.map((link) => nodeAttribute(link, "title"));
  if (
    JSON.stringify(titles) !== JSON.stringify(WIKIDOT_SOCIAL_SELECTED_TITLES) &&
    JSON.stringify(titles) !== JSON.stringify(WIKIDOT_SOCIAL_DEFAULT_TITLES)
  ) {
    return null;
  }
  for (const [index, link] of links.entries()) {
    const images = (link.children ?? []).filter((child) =>
      child.type === "element" && child.name === "img"
    );
    const href = nodeAttribute(link, "href") ?? "";
    if (
      images.length !== 1 ||
      nodeAttribute(link, "style") !== "margin: 0 2px" ||
      !/http%3A%2F%2F[a-z0-9-]+[.]wikidot[.]com%2Fajax-module-connector[.]php/iu
        .test(href) ||
      nodeAttribute(images[0], "alt") !== titles[index] ||
      !/^http:\/\/d3g0gp89917ko0\.cloudfront\.net\/v--7690939296dc\/common--images\/social\/[a-z]+[.](?:png|gif)$/u
        .test(nodeAttribute(images[0], "src") ?? "")
    ) {
      return null;
    }
  }
  return nonce;
}

function wikidotSocialScript(nonce) {
  return [
    "\n//<![CDATA[\n\n",
    `            var socialspan = $j("#${nonce}")[0];\n`,
    "            var els = socialspan.getElementsByTagName(\"a\");\n",
    "            for (var i=0;i<els.length;i++) {\n",
    "                els[i].href = els[i].href.replace(\"TITLE\", encodeURIComponent(document.title));\n",
    "            }\n",
    "//]]>\n",
  ].join("");
}

function parseFootnoteRoute(value, prefix) {
  const match = new RegExp(`^${prefix}-(?:(?<nonce>[0-9]+)-)?(?<index>[0-9]+)$`, "u")
    .exec(value ?? "");
  if (!match) return null;
  return {
    nonce: match.groups.nonce ?? null,
    index: match.groups.index,
  };
}

function normalizeCanonicalFootnoteNonces(nodes) {
  const state = {
    references: 0,
    footers: 0,
    invalid: 0,
    nonces: new Set(),
  };
  const normalizeAttributes = (node, replacements) => ({
    ...node,
    attrs: (node.attrs ?? []).map((attribute) => ({
      ...attribute,
      value: replacements.get(attribute.name) ?? attribute.value,
    })),
  });
  const normalizeNode = (node) => {
    if (node?.type !== "element") return { ...node };
    let normalized = {
      ...node,
      children: (node.children ?? []).map(normalizeNode),
    };
    if (node.name === "a" && nodeHasClass(node, "footnoteref")) {
      state.references += 1;
      const route = parseFootnoteRoute(
        nodeAttribute(node, "id"),
        "footnoteref",
      );
      const expectedTarget = route === null
        ? null
        : `WIKIDOT.page.utils.scrollToReference('footnote-${
          route.nonce === null ? "" : `${route.nonce}-`
        }${route.index}')`;
      if (
        route === null ||
        nodeAttribute(node, "href") !== "javascript:;" ||
        nodeAttribute(node, "onclick") !== expectedTarget ||
        nodeText(node).trim() !== route.index
      ) {
        state.invalid += 1;
      } else {
        if (route.nonce !== null) state.nonces.add(route.nonce);
        normalized = normalizeAttributes(normalized, new Map([
          ["id", `footnoteref-${route.index}`],
          [
            "onclick",
            `WIKIDOT.page.utils.scrollToReference('footnote-${route.index}')`,
          ],
        ]));
      }
    }
    if (node.name === "div" && nodeHasClass(node, "footnote-footer")) {
      state.footers += 1;
      const route = parseFootnoteRoute(nodeAttribute(node, "id"), "footnote");
      const backlinkEntries = (node.children ?? [])
        .map((child, index) => ({ child, index }))
        .filter(({ child }) =>
          child.type === "element" &&
          child.name === "a" &&
          nodeAttribute(child, "href") === "javascript:;" &&
          /^WIKIDOT[.]page[.]utils[.]scrollToReference[(]'footnoteref-/u
            .test(nodeAttribute(child, "onclick") ?? "")
        );
      const backlink = backlinkEntries.length === 1
        ? backlinkEntries[0]
        : null;
      const link = backlink?.child ?? null;
      const expectedTarget = route === null
        ? null
        : `WIKIDOT.page.utils.scrollToReference('footnoteref-${
          route.nonce === null ? "" : `${route.nonce}-`
        }${route.index}')`;
      if (
        route === null ||
        link === null ||
        nodeAttribute(link, "href") !== "javascript:;" ||
        nodeAttribute(link, "onclick") !== expectedTarget ||
        nodeText(link).trim() !== route.index
      ) {
        state.invalid += 1;
      } else {
        if (route.nonce !== null) state.nonces.add(route.nonce);
        normalized = normalizeAttributes(normalized, new Map([
          ["id", `footnote-${route.index}`],
        ]));
        normalized.children = normalized.children.map((child, index) =>
          index === backlink.index
            ? normalizeAttributes(child, new Map([
                [
                  "onclick",
                  `WIKIDOT.page.utils.scrollToReference('footnoteref-${route.index}')`,
                ],
              ]))
            : child
        );
      }
    }
    return normalized;
  };
  const normalized = (nodes ?? []).map(normalizeNode);
  if (
    state.references !== state.footers ||
    state.references === 0 ||
    state.nonces.size > 1
  ) {
    state.invalid += 1;
  }
  return { nodes: normalized, state };
}

function synchronizedImportedAuthorNames(nodes) {
  return new Set(
    (nodes ?? [])
      .flatMap((node) =>
        descendantElements(node, (candidate) =>
          nodeHasClass(candidate, "printuser") ||
          importedAuthorErrorInlineName(candidate) !== null
        )
      )
      .map((node) =>
        nodeText(node)
          .replace(/\s+does not match any existing user name$/iu, "")
          .trim()
      )
      .filter(Boolean),
  );
}

function canonicalImportedAuthorIdentity(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\p{Z}\p{P}\p{S}_]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function importedAuthorErrorInlineName(node) {
  if (
    node?.type !== "element" ||
    node.name !== "span" ||
    !nodeHasClass(node, "error-inline")
  ) {
    return null;
  }
  const children = node.children ?? [];
  if (
    children.length !== 2 ||
    children[0]?.type !== "element" ||
    children[0].name !== "em" ||
    children[0].children?.length !== 1 ||
    children[0].children[0]?.type !== "text" ||
    children[1]?.type !== "text" ||
    children[1].value !== " does not match any existing user name"
  ) {
    return null;
  }
  const name = nodeText(children[0]).trim();
  return name.length > 0 ? name : null;
}

function normalizeSynchronizedLinkedTitleSpaces(nodes) {
  let normalizedSpaces = 0;
  const normalizeNode = (node, insideLink = false) => {
    if (node?.type === "text") {
      if (!insideLink || !node.value.includes("\u00a0")) return { ...node };
      const value = node.value.replace(/\u00a0/gu, " ");
      normalizedSpaces += node.value.match(/\u00a0/gu)?.length ?? 0;
      return { ...node, value };
    }
    if (node?.type !== "element") return { ...node };
    const linked = insideLink ||
      (node.name === "a" && nodeAttribute(node, "href") !== null);
    return {
      ...node,
      children: (node.children ?? []).map((child) =>
        normalizeNode(child, linked)
      ),
    };
  };
  return {
    nodes: (nodes ?? []).map((node) => normalizeNode(node)),
    normalizedSpaces,
  };
}

function normalizeSynchronizedLinkedTitleTypography(liveNodes, localNodes) {
  let normalizedTitles = 0;
  const cloneNode = (node) => {
    if (node?.type !== "element") return { ...node };
    return {
      ...node,
      attrs: (node.attrs ?? []).map((attribute) => ({ ...attribute })),
      children: (node.children ?? []).map(cloneNode),
    };
  };
  const normalizePair = (live, local, insideListPages) => {
    if (
      live?.type !== "element" ||
      local?.type !== "element" ||
      live.name !== local.name
    ) {
      return [cloneNode(live), cloneNode(local)];
    }
    const insideOwned = insideListPages ||
      nodeHasClass(live, "list-pages-box") ||
      nodeHasClass(live, "list-pages-item");
    const liveHref = nodeAttribute(live, "href");
    const localHref = nodeAttribute(local, "href");
    const liveChildren = live.children ?? [];
    const localChildren = local.children ?? [];
    const linkedImportedTitle =
      insideOwned &&
      live.name === "a" &&
      liveHref === localHref &&
      /^\/(?!\/|ajax-module-connector[.]php|user:info\/|system:)[^\s]+$/u
        .test(liveHref ?? "") &&
      liveChildren.length === 1 &&
      localChildren.length === 1 &&
      liveChildren[0].type === "text" &&
      localChildren[0].type === "text" &&
      liveChildren[0].value.includes("--") &&
      liveChildren[0].value.replaceAll("--", "—") ===
        localChildren[0].value;
    if (linkedImportedTitle) {
      normalizedTitles += 1;
      const title = [{
        type: "text",
        value: `__IMPORTED_TITLE_FOR_${liveHref}__`,
      }];
      return [
        {
          ...live,
          attrs: (live.attrs ?? []).map((attribute) => ({ ...attribute })),
          children: title,
        },
        {
          ...local,
          attrs: (local.attrs ?? []).map((attribute) => ({ ...attribute })),
          children: title.map((child) => ({ ...child })),
        },
      ];
    }
    if (liveChildren.length !== localChildren.length) {
      return [cloneNode(live), cloneNode(local)];
    }
    const childPairs = liveChildren.map((child, index) =>
      normalizePair(child, localChildren[index], insideOwned)
    );
    return [
      {
        ...live,
        attrs: (live.attrs ?? []).map((attribute) => ({ ...attribute })),
        children: childPairs.map(([child]) => child),
      },
      {
        ...local,
        attrs: (local.attrs ?? []).map((attribute) => ({ ...attribute })),
        children: childPairs.map(([, child]) => child),
      },
    ];
  };
  if ((liveNodes ?? []).length !== (localNodes ?? []).length) {
    return {
      live: (liveNodes ?? []).map(cloneNode),
      local: (localNodes ?? []).map(cloneNode),
      normalizedTitles,
    };
  }
  const pairs = (liveNodes ?? []).map((node, index) =>
    normalizePair(node, localNodes[index], false)
  );
  return {
    live: pairs.map(([node]) => node),
    local: pairs.map(([, node]) => node),
    normalizedTitles,
  };
}

function normalizeSynchronizedComposedLinkedTitles(nodes) {
  let normalizedTitles = 0;
  const normalizeNode = (node) => {
    if (node?.type !== "element") return { ...node };
    const href = nodeAttribute(node, "href");
    const composedTitle = node.name === "a" &&
      /^https?:\/\/[a-z0-9-]+[.]wikidot[.]com\/[^?#]+\/noredirect\/true$/iu
        .test(href ?? "") &&
      (node.children ?? []).length === 1 &&
      node.children[0].type === "text";
    if (composedTitle) normalizedTitles += 1;
    return {
      ...node,
      attrs: (node.attrs ?? []).map((attribute) => ({ ...attribute })),
      children: composedTitle
        ? [{ type: "text", value: `__IMPORTED_TITLE_FOR_${href}__` }]
        : (node.children ?? []).map(normalizeNode),
    };
  };
  return {
    nodes: (nodes ?? []).map(normalizeNode),
    normalizedTitles,
  };
}

function normalizeSynchronizedImportedPageExistence(nodes) {
  let normalizedTargets = 0;
  const normalizeNode = (node) => {
    if (node?.type !== "element") return { ...node };
    const href = nodeAttribute(node, "href");
    const className = nodeAttribute(node, "class");
    const normalizeTarget = node.name === "a" &&
      className === "newpage" &&
      /^\/(?!\/)[^\s]*$/u.test(href ?? "");
    if (normalizeTarget) normalizedTargets += 1;
    return {
      ...node,
      attrs: (node.attrs ?? [])
        .filter((attribute) =>
          !(normalizeTarget && attribute.name === "class")
        )
        .map((attribute) => ({ ...attribute })),
      children: (node.children ?? []).map(normalizeNode),
    };
  };
  return {
    nodes: (nodes ?? []).map(normalizeNode),
    normalizedTargets,
  };
}

function normalizeSynchronizedImportedFileOrigins(nodes) {
  let normalizedOrigins = 0;
  const normalizeNode = (node) => {
    if (node?.type !== "element") return { ...node };
    return {
      ...node,
      attrs: (node.attrs ?? []).map((attribute) => {
        if (!["href", "src"].includes(attribute.name)) {
          return { ...attribute };
        }
        const match =
          /^http:\/\/(?<site>[a-z0-9-]+)[.]wikidot[.]com(?<path>\/local--files\/.*)$/iu
            .exec(attribute.value);
        if (!match) return { ...attribute };
        normalizedOrigins += 1;
        return {
          ...attribute,
          value:
            `https://${match.groups.site}.files.invalid${match.groups.path}`,
        };
      }),
      children: (node.children ?? []).map(normalizeNode),
    };
  };
  return {
    nodes: (nodes ?? []).map(normalizeNode),
    normalizedOrigins,
  };
}

function synchronizedFirstImageDescriptor(row) {
  if (!nodeHasClass(row, "list-pages-item")) return null;
  const children = row.children ?? [];
  const imageIndex = children.findIndex((child) =>
    child.type === "element" ||
    (child.type === "text" && child.value.trim().length > 0)
  );
  const image = children[imageIndex];
  if (image?.type !== "element" || image.name !== "img") return null;
  const attributes = new Map(
    (image.attrs ?? []).map((attribute) => [attribute.name, attribute.value]),
  );
  if (
    attributes.size !== 3 ||
    attributes.get("class") !== "image" ||
    !attributes.has("alt") ||
    !attributes.has("src")
  ) {
    return null;
  }
  const source =
    /^https:\/\/[a-z0-9-]+[.]files[.]invalid\/local--files\/(?<page>[^/?#]+)\/(?<file>[^/?#]+)$/iu
      .exec(attributes.get("src"));
  if (!source) return null;
  let decodedFile;
  try {
    decodedFile = decodeURIComponent(source.groups.file);
  } catch {
    return null;
  }
  if (decodedFile !== attributes.get("alt")) return null;
  const pageHref = `/${source.groups.page}`;
  const links = descendantElements(row, (candidate) =>
    candidate.name === "a" && nodeAttribute(candidate, "href") === pageHref
  );
  return links.length === 1
    ? { imageIndex, pageHref }
    : null;
}

function synchronizedListPagesRows(nodes) {
  const rows = new Map();
  let invalid = 0;
  for (const root of nodes ?? []) {
    for (
      const row of descendantElements(root, (candidate) =>
        nodeHasClass(candidate, "list-pages-item")
      )
    ) {
      const internalLinks = descendantElements(row, (candidate) =>
        candidate.name === "a" &&
        /^\/(?!\/)[^\s]*$/u.test(nodeAttribute(candidate, "href") ?? "")
      );
      const pageHref = internalLinks[0] === undefined
        ? null
        : nodeAttribute(internalLinks[0], "href");
      if (pageHref === null || rows.has(pageHref)) {
        invalid += 1;
        continue;
      }
      const firstImage = synchronizedFirstImageDescriptor(row);
      rows.set(pageHref, { firstImage });
    }
  }
  return { rows, invalid };
}

function removeSynchronizedFirstImages(nodes, pageHrefs) {
  const normalizeNode = (node) => {
    if (node?.type !== "element") return { ...node };
    const descriptor = synchronizedFirstImageDescriptor(node);
    return {
      ...node,
      attrs: (node.attrs ?? []).map((attribute) => ({ ...attribute })),
      children: (node.children ?? [])
        .filter((_child, index) =>
          descriptor === null ||
          !pageHrefs.has(descriptor.pageHref) ||
          index !== descriptor.imageIndex
        )
        .map(normalizeNode),
    };
  };
  return (nodes ?? []).map(normalizeNode);
}

function normalizeSynchronizedFirstImageFixture(liveNodes, localNodes) {
  const live = synchronizedListPagesRows(liveNodes);
  const local = synchronizedListPagesRows(localNodes);
  const liveKeys = [...live.rows.keys()];
  const localKeys = [...local.rows.keys()];
  if (
    live.invalid > 0 ||
    local.invalid > 0 ||
    liveKeys.length === 0 ||
    JSON.stringify(liveKeys) !== JSON.stringify(localKeys)
  ) {
    return null;
  }
  const liveOnly = new Set();
  const localOnly = new Set();
  for (const key of liveKeys) {
    const liveImage = live.rows.get(key).firstImage;
    const localImage = local.rows.get(key).firstImage;
    if (liveImage !== null && localImage === null) liveOnly.add(key);
    if (liveImage === null && localImage !== null) localOnly.add(key);
  }
  if (liveOnly.size + localOnly.size === 0) return null;
  return {
    live: removeSynchronizedFirstImages(liveNodes, liveOnly),
    local: removeSynchronizedFirstImages(localNodes, localOnly),
    normalizedRows: liveOnly.size + localOnly.size,
  };
}

function normalizeSynchronizedRuntimeFixtures(nodes, {
  importedAuthorNames = new Set(),
  normalizeFeaturedSite = false,
  normalizeSocialNonce = false,
  normalizeHtmlBlockNonce = false,
} = {}) {
  const state = {
    importedAuthors: 0,
    dates: 0,
    featuredSites: 0,
    invalidFeaturedSites: 0,
    socialWidgets: 0,
    socialScripts: 0,
    invalidSocialWidgets: 0,
    htmlBlocks: 0,
    invalidHtmlBlocks: 0,
  };
  const importedAuthorIdentities = new Map(
    [...importedAuthorNames].map((name) => [
      name.toLowerCase(),
      `__IMPORTED_AUTHOR_${canonicalImportedAuthorIdentity(name)}__`,
    ]),
  );
  const socialNonces = new Set();
  const normalizeImportedAuthor = (node, appendSpace) => {
    state.importedAuthors += 1;
    const userLink = descendantElements(
      node,
      (candidate) => candidate.name === "a" &&
        /(?:^|\/)user:info\//iu.test(nodeAttribute(candidate, "href") ?? ""),
    ).at(-1);
    const hrefIdentity = /(?:^|\/)user:info\/(?<name>[^/?#]+)$/iu.exec(
      nodeAttribute(userLink, "href") ?? "",
    )?.groups?.name;
    const textIdentity = nodeText(node)
      .replace(/\s+does not match any existing user name$/iu, "")
      .trim();
    const identity = canonicalImportedAuthorIdentity(
      hrefIdentity ?? textIdentity,
    );
    return {
      type: "text",
      value: `__IMPORTED_AUTHOR_${identity}__${appendSpace ? " " : ""}`,
    };
  };
  const normalizeChildren = (children) => {
    const output = [];
    const childNodes = children ?? [];
    for (const [index, child] of childNodes.entries()) {
      const following = childNodes[index + 1];
      const normalizedChildren = child?.type === "element" &&
          nodeHasClass(child, "printuser")
        ? [
            normalizeImportedAuthor(
              child,
              following?.type === "element" &&
                !["br", "sup"].includes(following.name),
            ),
          ]
        : importedAuthorErrorInlineName(child) !== null
          ? [
              normalizeImportedAuthor(
                child,
                following?.type === "element" &&
                  !["br", "sup"].includes(following.name),
              ),
            ]
        : normalizeNode(child);
      for (const normalized of normalizedChildren) {
        const previous = output.at(-1);
        if (previous?.type === "text" && normalized.type === "text") {
          previous.value += normalized.value;
        } else {
          output.push(normalized);
        }
      }
    }
    return output;
  };
  const normalizeNode = (node) => {
    if (node?.type === "text") {
      const exactIdentity = importedAuthorIdentities.get(
        node.value.trim().toLowerCase(),
      );
      if (exactIdentity !== undefined) {
        return [{ ...node, value: exactIdentity }];
      }
      let value = node.value;
      for (const [name, identity] of importedAuthorIdentities) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
        value = value.replace(
          new RegExp(
            `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
            "giu",
          ),
          identity,
        );
      }
      if (value !== node.value) {
        return [{ ...node, value }];
      }
      return [{ ...node }];
    }
    if (node?.type !== "element") return [{ ...node }];
    if (nodeHasClass(node, "printuser")) {
      return [normalizeImportedAuthor(node, false)];
    }
    if (importedAuthorErrorInlineName(node) !== null) {
      return [normalizeImportedAuthor(node, false)];
    }
    if (nodeHasClass(node, "odate")) {
      state.dates += 1;
      return [{ type: "text", value: nodeText(node) }];
    }
    if (normalizeFeaturedSite && nodeHasClass(node, "featured-site-box")) {
      state.featuredSites += 1;
      if (!featuredSiteBoxHasCanonicalStructure(node)) {
        state.invalidFeaturedSites += 1;
      } else {
        return [{ type: "text", value: "__ROTATING_FEATURED_SITE__" }];
      }
    }
    if (normalizeSocialNonce) {
      const socialNonce = wikidotSocialSpanNonce(node);
      if (node.name === "span" && /^social/u.test(nodeAttribute(node, "id") ?? "")) {
        state.socialWidgets += 1;
        if (socialNonce === null) {
          state.invalidSocialWidgets += 1;
        } else {
          socialNonces.add(socialNonce);
          return [{
            ...node,
            attrs: (node.attrs ?? []).map((attribute) => ({
              ...attribute,
              value: attribute.name === "id"
                ? "social__NONCE__"
                : attribute.value,
            })),
            children: normalizeChildren(node.children).map((child) => {
              if (
                child.type !== "element" ||
                child.name !== "a" ||
                nodeAttribute(child, "title") !== "Fark"
              ) {
                return child;
              }
              return {
                ...child,
                attrs: (child.attrs ?? []).map((attribute) => ({
                  ...attribute,
                  value: attribute.name === "href"
                    ? attribute.value.replace(
                      /(&new_comment=TITLE&new_comment=)[^&]+/u,
                      "$1__SYNCHRONIZED_SITE_NAME__",
                    )
                    : attribute.value,
                })),
              };
            }),
          }];
        }
      }
      if (node.name === "script") {
        const script = nodeText(node);
        const nonce = [...socialNonces]
          .find((candidate) => script === wikidotSocialScript(candidate));
        if (nonce !== undefined) {
          state.socialScripts += 1;
          return [{
            ...node,
            attrs: (node.attrs ?? []).map((attribute) => ({ ...attribute })),
            children: [{
              type: "text",
              value: wikidotSocialScript("social__NONCE__"),
            }],
          }];
        }
      }
    }
    if (
      normalizeHtmlBlockNonce &&
      node.name === "iframe" &&
      nodeHasClass(node, "html-block-iframe")
    ) {
      state.htmlBlocks += 1;
      const src = nodeAttribute(node, "src") ?? "";
      if (
        !/^\/[a-z0-9_:-]+\/html\/[a-f0-9]{40}-[0-9]+$/iu.test(src) ||
        nodeAttribute(node, "allowtransparency") !== "true" ||
        nodeAttribute(node, "frameborder") !== "0"
      ) {
        state.invalidHtmlBlocks += 1;
      } else {
        return [{
          ...node,
          attrs: (node.attrs ?? []).map((attribute) => ({
            ...attribute,
            value: attribute.name === "src"
              ? attribute.value.replace(
                /^\/[a-z0-9_:-]+\/html\/(?<hash>[a-f0-9]{40})-[0-9]+$/iu,
                "/__PREVIEW_PAGE__/html/$<hash>-__NONCE__",
              )
              : attribute.value,
          })),
          children: normalizeChildren(node.children),
        }];
      }
    }
    return [{
      ...node,
      attrs: (node.attrs ?? []).map((attribute) => ({ ...attribute })),
      children: normalizeChildren(node.children),
    }];
  };
  return {
    nodes: normalizeChildren(nodes),
    state,
  };
}

function templateVariables(source) {
  return [...source.matchAll(/%%[A-Za-z0-9_]+%%/gu)]
    .map((match) => match[0]);
}

function resolvesTemplateVariables(source, visibleText) {
  const variables = templateVariables(source);
  return variables.length > 0 &&
    variables.every((variable) => !visibleText.includes(variable));
}

function missingVisibleLineArgument(source, liveText, localText) {
  const invocations = extractListPagesInvocationsFromSource({
    branch: "classification",
    pageFullname: "preview",
    sourcePath: "preview",
    source,
  });
  return invocations
    .flatMap((invocation) => invocation.attributes ?? [])
    .filter((attribute) =>
      ["prependline", "appendline"].includes(attribute.name.toLowerCase())
    )
    .map((attribute) => attribute.value)
    .find((value) =>
      value.length > 0 &&
      liveText.includes(value) &&
      !localText.includes(value)
    ) ?? null;
}

function nodeHasClass(node, className) {
  return node?.attrs
    ?.find((attribute) => attribute.name === "class")
    ?.value.split(/\s+/u)
    .includes(className) ?? false;
}

function topLevelNodesWithClass(nodes, className) {
  return (nodes ?? []).filter((node) =>
    node.type === "element" && nodeHasClass(node, className)
  );
}

function exactSingleInvocation(source) {
  const invocations = extractListPagesInvocationsFromSource({
    branch: "classification",
    pageFullname: "preview",
    sourcePath: "preview",
    source,
  });
  if (
    invocations.length !== 1 ||
    invocations[0].source.trim() !== source.trim()
  ) {
    return null;
  }
  return invocations[0];
}

function oneArgumentValue(invocation, name) {
  const values = invocation.attributes
    .filter((attribute) => attribute.name.toLowerCase() === name)
    .map((attribute) => attribute.value);
  return values.length <= 1 ? (values[0] ?? null) : undefined;
}

function lastArgumentValue(invocation, name) {
  return invocation.attributes
    .filter((attribute) => attribute.name.toLowerCase() === name)
    .map((attribute) => attribute.value)
    .at(-1) ?? null;
}

function invocationExpectsWrapper(invocation) {
  const value = oneArgumentValue(invocation, "wrapper");
  if (value === undefined) return null;
  return !["no", "false"].includes(value?.trim().toLowerCase() ?? "");
}

function invocationUsesCombinedSections(invocation) {
  const value = oneArgumentValue(invocation, "separate");
  return value !== undefined &&
    ["no", "false"].includes(value?.trim().toLowerCase() ?? "");
}

function canonicalNodeLines(node) {
  const tokens = [];
  const blockNames = new Set([
    "p",
    "div",
    "blockquote",
    "li",
    "dt",
    "dd",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "tr",
    "td",
    "th",
    "pre",
  ]);
  const pushBreak = () => {
    if (tokens.at(-1) !== "\n") tokens.push("\n");
  };
  const visit = (current) => {
    if (current?.type === "text") {
      tokens.push(current.value);
      return;
    }
    if (current?.type !== "element") return;
    if (current.name === "br") {
      pushBreak();
      return;
    }
    const block = blockNames.has(current.name);
    if (block) pushBreak();
    for (const child of current.children ?? []) visit(child);
    if (block) pushBreak();
  };
  visit(node);
  return tokens
    .join("")
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean);
}

function plainSectionTemplates(invocation) {
  const sections = new Map();
  for (const match of invocation.body.matchAll(
    /\[\[(head|body|foot)\]\]([\s\S]*?)\[\[\/\1\]\]/giu,
  )) {
    sections.set(match[1].toLowerCase(), match[2]);
  }
  return sections;
}

function plainSectionText(source) {
  if (/\[\[|\]\]|%%|@@|@<|\{\{|\}\}/u.test(source)) return null;
  const text = source.replace(/\s+/gu, " ").trim();
  return text || null;
}

function plainBodyAnchor(source) {
  // Row variables are intentionally allowed here and removed below. Reject
  // only syntax that can change the body structure around the static anchor.
  if (/\[\[|\]\]|@@|@<|\{\{|\}\}/u.test(source)) return null;
  const text = source
    .replace(/%%[A-Za-z0-9_]+%%/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return text.length >= 3 ? text : null;
}

function missingPlainAuthoredSection({
  invocation,
  liveWrapper,
  localWrapper,
}) {
  if (!invocationUsesCombinedSections(invocation)) return null;
  const sections = plainSectionTemplates(invocation);
  const bodyAnchor = plainBodyAnchor(sections.get("body") ?? "");
  const liveLines = canonicalNodeLines(liveWrapper);
  const localLines = canonicalNodeLines(localWrapper);
  const liveBodyIndices = bodyAnchor === null
    ? []
    : liveLines.flatMap((line, index) =>
        line.includes(bodyAnchor) ? [index] : []
      );
  const localBodyIndices = bodyAnchor === null
    ? []
    : localLines.flatMap((line, index) =>
        line.includes(bodyAnchor) ? [index] : []
      );

  for (const section of ["head", "foot"]) {
    const authored = plainSectionText(sections.get(section) ?? "");
    if (authored === null) continue;
    const liveIndices = liveLines.flatMap((line, index) =>
      line === authored ? [index] : []
    );
    if (liveIndices.length === 0) continue;
    const localIndices = localLines.flatMap((line, index) =>
      line === authored ? [index] : []
    );
    if (liveBodyIndices.length > 0 && localBodyIndices.length > 0) {
      const liveBodyBoundary = section === "head"
        ? liveBodyIndices[0]
        : liveBodyIndices.at(-1);
      const localBodyBoundary = section === "head"
        ? localBodyIndices[0]
        : localBodyIndices.at(-1);
      const liveIsSection = section === "head"
        ? liveIndices.some((index) => index < liveBodyBoundary)
        : liveIndices.some((index) => index > liveBodyBoundary);
      const localIsSection = section === "head"
        ? localIndices.some((index) => index < localBodyBoundary)
        : localIndices.some((index) => index > localBodyBoundary);
      if (liveIsSection && !localIsSection) {
        return { section, authored };
      }
      continue;
    }
    if (localLines.length === 0) {
      return { section, authored };
    }
  }
  return null;
}

function localOutputIsLiveOutputWithoutGeneratedWrapper(
  liveNodes,
  liveTopLevelWrappers,
  localNodes,
) {
  if (liveTopLevelWrappers.length !== 1) return false;
  const wrapper = liveTopLevelWrappers[0];
  const wrapperIndex = liveNodes.indexOf(wrapper);
  if (wrapperIndex < 0) return false;
  const unwrappedLiveNodes = [
    ...liveNodes.slice(0, wrapperIndex),
    ...(wrapper.children ?? []),
    ...liveNodes.slice(wrapperIndex + 1),
  ];
  return JSON.stringify(unwrappedLiveNodes) === JSON.stringify(localNodes ?? []);
}

const EVIDENCED_MALFORMED_DEFAULT_ROW_HEAD =
  "[[module Listpages @@以降という認識で良い。 [[/footnote]]";

function defaultListPagesRowShell(item) {
  if (
    item?.type !== "element" ||
    item.name !== "div" ||
    !nodeHasClass(item, "list-pages-item") ||
    (item.children ?? []).length < 2
  ) {
    return null;
  }
  const [heading, attribution] = item.children;
  const span = heading?.children?.length === 1
    ? heading.children[0]
    : null;
  const link = span?.children?.length === 1
    ? span.children[0]
    : null;
  const printusers = descendantElements(
    attribution,
    (node) => nodeHasClass(node, "printuser"),
  );
  const dates = descendantElements(
    attribution,
    (node) => nodeHasClass(node, "odate"),
  );
  if (
    heading?.type !== "element" ||
    heading.name !== "h1" ||
    span?.type !== "element" ||
    span.name !== "span" ||
    link?.type !== "element" ||
    link.name !== "a" ||
    !/^\/(?!\/)[^\s]*$/u.test(nodeAttribute(link, "href") ?? "") ||
    nodeText(link).trim().length === 0 ||
    attribution?.type !== "element" ||
    attribution.name !== "p" ||
    !nodeText(attribution).startsWith("by ") ||
    printusers.length !== 1 ||
    dates.length !== 1
  ) {
    return null;
  }
  return {
    type: item.type,
    name: item.name,
    namespace: item.namespace,
    attrs: item.attrs,
    children: [heading, attribution],
  };
}

function malformedDefaultRowsHaveExactListPagesShell({
  invocation,
  liveTopLevelWrappers,
  localTopLevelWrappers,
  localUnsupportedDiagnostic,
}) {
  if (
    localUnsupportedDiagnostic ||
    invocation === null ||
    invocation.head !== EVIDENCED_MALFORMED_DEFAULT_ROW_HEAD ||
    invocation.balanced !== false ||
    invocation.malformed_reason !== "missing-module-close" ||
    invocation.attributes.length !== 0 ||
    liveTopLevelWrappers.length !== 1 ||
    localTopLevelWrappers.length !== 1
  ) {
    return false;
  }
  const project = (wrapper) => {
    if (
      wrapper?.type !== "element" ||
      wrapper.name !== "div" ||
      !nodeHasClass(wrapper, "list-pages-box")
    ) {
      return null;
    }
    const children = wrapper.children ?? [];
    const pagers = children
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => nodeHasClass(node, "pager"));
    if (
      pagers.length !== 1 ||
      pagers[0].index !== children.length - 1 ||
      children.length < 2
    ) {
      return null;
    }
    const rows = children.slice(0, -1).map(defaultListPagesRowShell);
    if (rows.length === 0 || rows.some((row) => row === null)) {
      return null;
    }
    return {
      type: wrapper.type,
      name: wrapper.name,
      namespace: wrapper.namespace,
      attrs: wrapper.attrs,
      rows,
      pager: pagers[0].node,
    };
  };
  const live = project(liveTopLevelWrappers[0]);
  const local = project(localTopLevelWrappers[0]);
  return live !== null &&
    local !== null &&
    JSON.stringify(live) === JSON.stringify(local);
}

function randomSelectedRowTemplateKind(invocation) {
  if (
    invocation === null ||
    lastArgumentValue(invocation, "order")?.trim().toLowerCase() !== "random"
  ) {
    return null;
  }
  const limit = lastArgumentValue(invocation, "limit")?.trim() ?? "";
  const perPage = lastArgumentValue(invocation, "perpage")?.trim() ?? "";
  if (
    ![limit, perPage].some((value) => /^(?:@url\|)?[1-9][0-9]*$/iu.test(value))
  ) {
    return null;
  }
  const body = invocation.body;
  if (/%%(?:title_linked|linked_title)%%/iu.test(body)) {
    return "linked-title";
  }
  if (/%%name%%/iu.test(body) && /%%title%%/iu.test(body)) {
    return "name-title";
  }
  if (
    /%%size%%\s*%\s*[0-9]+/iu.test(body) &&
    /#ifexpr/iu.test(body)
  ) {
    return "size-branch";
  }
  return null;
}

function cloneRandomStateNode(node, normalizeContent) {
  if (node?.type === "text") {
    return normalizeContent
      ? { ...node, value: "__RANDOM_SELECTED_ROW_TEXT__" }
      : { ...node };
  }
  if (node?.type !== "element") return { ...node };
  return {
    ...node,
    attrs: (node.attrs ?? []).map((attribute) => ({
      ...attribute,
      value: normalizeContent
        ? "__RANDOM_SELECTED_ROW_ATTRIBUTE__"
        : attribute.value,
    })),
    children: (node.children ?? []).map((child) =>
      cloneRandomStateNode(child, normalizeContent)
    ),
  };
}

function normalizeRandomSelectedRowState(nodes, wrapperExpected) {
  if (!wrapperExpected) {
    return (nodes ?? []).map((node) => cloneRandomStateNode(node, true));
  }
  const normalizeWrapper = (wrapper) => {
    const hasItems = descendantElements(
      wrapper,
      (node) => nodeHasClass(node, "list-pages-item"),
    ).length > 0;
    const normalizeChild = (child) => {
      if (nodeHasClass(child, "pager")) {
        return cloneRandomStateNode(child, false);
      }
      if (!wrapperExpected || !hasItems) {
        return cloneRandomStateNode(child, true);
      }
      if (nodeHasClass(child, "list-pages-item")) {
        return cloneRandomStateNode(child, true);
      }
      return cloneRandomStateNode(child, false);
    };
    return {
      ...wrapper,
      attrs: (wrapper.attrs ?? []).map((attribute) => ({ ...attribute })),
      children: (wrapper.children ?? []).map(normalizeChild),
    };
  };
  return (nodes ?? []).map((node) =>
    nodeHasClass(node, "list-pages-box")
      ? normalizeWrapper(node)
      : cloneRandomStateNode(node, false)
  );
}

function relativeTimeSelector(invocation) {
  if (invocation === null) return null;
  for (const attribute of invocation.attributes) {
    if (!/(?:^date$|^created_at$|^updated_at$)/iu.test(attribute.name)) {
      continue;
    }
    const value = attribute.value.trim();
    if (/^(?:last|older than)\s+[0-9]+\s+(?:day|days|hour|hours)$/iu.test(value) ||
      /^(?:@url\|)?last\s+month$/iu.test(value)) {
      return { name: attribute.name.toLowerCase(), value };
    }
  }
  return null;
}

function normalizeRelativeTemporalNode(node) {
  if (node?.type !== "element") return { ...node };
  if (nodeHasClass(node, "odate")) {
    return {
      type: node.type,
      name: node.name,
      namespace: node.namespace,
      attrs: (node.attrs ?? []).map((attribute) => ({
        ...attribute,
        value: attribute.name === "class"
          ? attribute.value.replace(/\btime_[0-9]+\b/gu, "time__RELATIVE__")
          : attribute.value,
      })),
      children: [{ type: "text", value: "__RELATIVE_DATE__" }],
    };
  }
  return {
    ...node,
    attrs: (node.attrs ?? []).map((attribute) => ({ ...attribute })),
    children: (node.children ?? []).map(normalizeRelativeTemporalNode),
  };
}

function relativeTemporalBodyUsesOnlyDynamicFields(body) {
  const withoutDynamicFields = body
    .replace(
      /%%(?:created_at|updated_at|created_by|fullname|title|title_linked|linked_title|rating|votes|children|name|link)(?:\|[^%]*)?%%/giu,
      "",
    )
    .replace(/%%content\{[0-9]+\}%%/giu, "")
    .replace(/[\s>*|()[\]{}"=:/%?&;,_+\-]/gu, "");
  return !/[\p{L}\p{N}]/u.test(withoutDynamicFields);
}

function normalizeRelativeTemporalTableNode(node, inRow = false, inPager = false) {
  if (node?.type === "text") {
    return inRow || inPager
      ? { ...node, value: "__RELATIVE_DYNAMIC_TEXT__" }
      : { ...node };
  }
  if (node?.type !== "element") return { ...node };
  const row = inRow || node.name === "tr";
  const pager = inPager || nodeHasClass(node, "pager");
  return {
    ...node,
    attrs: (node.attrs ?? []).map((attribute) => ({
      ...attribute,
      value: row && attribute.name === "href" &&
          /^\/(?!ajax-module-connector\.php\/)/iu.test(attribute.value)
        ? "__RELATIVE_DYNAMIC_HREF__"
        : pager && attribute.name === "href"
          ? "__RELATIVE_PAGER_HREF__"
          : nodeHasClass(node, "odate") && attribute.name === "class"
            ? attribute.value.replace(/\btime_[0-9]+\b/gu, "time__RELATIVE__")
            : attribute.value,
    })),
    children: (node.children ?? []).map((child) =>
      normalizeRelativeTemporalTableNode(child, row, pager)
    ),
  };
}

function relativeTemporalTableFixtureProof({
  invocation,
  liveWrapper,
  localWrapper,
  bound,
}) {
  if (!relativeTemporalBodyUsesOnlyDynamicFields(invocation.body)) {
    return null;
  }
  const table = (wrapper) => {
    const matches = descendantElements(
      wrapper,
      (node) => node.name === "table" && nodeHasClass(node, "wiki-content-table"),
    );
    return matches.length === 1 ? matches[0] : null;
  };
  const liveTable = table(liveWrapper);
  const localTable = table(localWrapper);
  if (liveTable === null || localTable === null) return null;
  const rows = (tableNode) => descendantElements(
    tableNode,
    (node) => node.name === "tr",
  );
  const liveRows = rows(liveTable);
  const localRows = rows(localTable);
  if (
    liveRows.length === 0 ||
    localRows.length === 0 ||
    liveRows.length > bound ||
    localRows.length > bound ||
    liveRows.some((row) => descendantElements(row, (node) =>
      node.name === "a" && /^\/(?!ajax-module-connector\.php\/)/iu.test(
        nodeAttribute(node, "href") ?? "",
      )
    ).length === 0) ||
    localRows.some((row) => descendantElements(row, (node) =>
      node.name === "a" && /^\/(?!ajax-module-connector\.php\/)/iu.test(
        nodeAttribute(node, "href") ?? "",
      )
    ).length === 0)
  ) {
    return null;
  }
  const liveNormalized = normalizeRelativeTemporalTableNode(liveWrapper);
  const localNormalized = normalizeRelativeTemporalTableNode(localWrapper);
  return JSON.stringify(liveNormalized) === JSON.stringify(localNormalized)
    ? { mode: "table-row-set" }
    : null;
}

function relativeTemporalFixtureProof({
  invocation,
  liveNodes,
  localNodes,
  liveTopLevelWrappers,
  localTopLevelWrappers,
}) {
  const selector = relativeTimeSelector(invocation);
  if (
    selector === null ||
    liveTopLevelWrappers.length !== 1 ||
    localTopLevelWrappers.length !== 1
  ) {
    return null;
  }
  const liveWrapper = liveTopLevelWrappers[0];
  const localWrapper = localTopLevelWrappers[0];
  const liveItems = descendantElements(
    liveWrapper,
    (node) => nodeHasClass(node, "list-pages-item"),
  );
  const localItems = descendantElements(
    localWrapper,
    (node) => nodeHasClass(node, "list-pages-item"),
  );
  const limit = lastArgumentValue(invocation, "limit")?.trim() ?? "";
  const perPage = lastArgumentValue(invocation, "perpage")?.trim() ?? "";
  const bound = [limit, perPage]
    .map((value) => /^(?:@url\|)?(?<count>[1-9][0-9]*)$/iu.exec(value)?.groups?.count)
    .filter(Boolean)
    .map(Number)
    .at(0) ?? 0;
  if (bound === 0 || liveItems.length > bound || localItems.length > bound) return null;
  if (liveItems.length === 0 && localItems.length === 0) {
    const tableProof = relativeTemporalTableFixtureProof({
      invocation,
      liveWrapper,
      localWrapper,
      bound,
    });
    return tableProof === null ? null : { selector, ...tableProof };
  }
  if (localItems.length === 0) {
    const localChildren = (localWrapper.children ?? []).filter((node) =>
      !(node.type === "text" && node.value.trim() === "")
    );
    if (localChildren.length !== 0) return null;
    const liveRowsHaveTemporalMetadata = liveItems.every((item) =>
      descendantElements(item, (node) => nodeHasClass(node, "odate")).length > 0
    );
    const randomRelativeSelectedLinkRows =
      lastArgumentValue(invocation, "order")?.trim().toLowerCase() === "random" &&
      invocationExpectsWrapper(invocation) === true &&
      !/#ifexpr\b/iu.test(invocation.body) &&
      /%%(?:link|title_linked|linked_title)%%/iu.test(invocation.body) &&
      liveItems.every((item) =>
        descendantElements(item, (node) => node.name === "a").length === 1
      );
    if (!liveRowsHaveTemporalMetadata && !randomRelativeSelectedLinkRows) {
      return null;
    }
    return { selector, mode: "live-row-local-empty" };
  }
  if (liveItems.length !== 1 || localItems.length !== 1) return null;
  const liveNormalized = liveNodes.map(normalizeRelativeTemporalNode);
  const localNormalized = localNodes.map(normalizeRelativeTemporalNode);
  return JSON.stringify(liveNormalized) === JSON.stringify(localNormalized)
    ? { selector, mode: "same-row-date-only" }
    : null;
}

function normalizeUrlSelectorFixtureNode(node, inRows = false) {
  if (node?.type === "text") {
    return inRows
      ? { ...node, value: "__URL_SELECTOR_ROW_TEXT__" }
      : { ...node };
  }
  if (node?.type !== "element") return { ...node };
  const row = inRows || node.name === "blockquote";
  const selectedLink =
    row &&
    node.name === "a" &&
    nodeAttribute(node, "target") === "_blank" &&
    /^\/(?!\/)/u.test(nodeAttribute(node, "href") ?? "");
  const importedUserLink = row &&
    node.name === "a" &&
    /(?:^|\/)user:info\//iu.test(nodeAttribute(node, "href") ?? "");
  return {
    ...node,
    attrs: (node.attrs ?? []).map((attribute) => ({
      ...attribute,
      value: selectedLink && attribute.name === "href"
        ? "__URL_SELECTOR_SELECTED_LINK_HREF__"
        : row && nodeHasClass(node, "odate") && attribute.name === "class"
          ? attribute.value.replace(/\btime_[0-9]+\b/gu, "time__URL_SELECTOR_DATE__")
          : importedUserLink &&
              ["href", "onclick"].includes(attribute.name)
            ? `__URL_SELECTOR_USER_${attribute.name.toUpperCase()}__`
            : row && node.name === "img" &&
                ["alt", "src", "style"].includes(attribute.name)
              ? `__URL_SELECTOR_AVATAR_${attribute.name.toUpperCase()}__`
              : attribute.value,
    })),
    children: (node.children ?? []).map((child) =>
      normalizeUrlSelectorFixtureNode(child, row || selectedLink)
    ),
  };
}

function urlSelectorBodyUsesOnlyDynamicFields(body) {
  const withoutDynamicFields = body
    .replace(
      /%%(?:created_at|created_by|fullname|title)(?:\|.*?)?%%/giu,
      "",
    )
    // The URL-selector proof is deliberately limited to the captured body
    // grammar: after removing its four row variables and Wikidot's structural
    // tokens, no authored word may remain for the row-text projection to
    // replace.  A label or any other static text therefore stays actionable.
    .replace(/\[\[[\s\S]*?\]\]/gu, "")
    .replace(/@@/gu, "")
    .replace(/[\s>*|()[\]{}"=:/%?&;,_+\-]/gu, "");
  return !/[\p{L}\p{N}]/u.test(withoutDynamicFields);
}

function urlSelectorFixtureProof({
  invocation,
  liveNodes,
  localNodes,
  liveTopLevelWrappers,
  localTopLevelWrappers,
}) {
  if (
    invocation === null ||
    lastArgumentValue(invocation, "created_at")?.trim() !== "@URL" ||
    lastArgumentValue(invocation, "perpage")?.trim() !== "250" ||
    lastArgumentValue(invocation, "separate")?.trim().toLowerCase() !== "no" ||
    lastArgumentValue(invocation, "order")?.trim().toLowerCase() !== "created_by" ||
    !/%%created_by(?:_linked)?%%/iu.test(invocation.body) ||
    !/%%fullname%%/iu.test(invocation.body) ||
    !/%%title%%/iu.test(invocation.body) ||
    !urlSelectorBodyUsesOnlyDynamicFields(invocation.body) ||
    liveTopLevelWrappers.length !== 1 ||
    localTopLevelWrappers.length !== 1
  ) {
    return null;
  }
  const project = (wrapper) => {
    const children = wrapper.children ?? [];
    const pager = children.filter((node) => nodeHasClass(node, "pager"));
    const rows = children.filter((node) => node.type === "element" &&
      node.name === "blockquote");
    if (pager.length !== 1 || rows.length !== 1 || children.length !== 2) {
      return null;
    }
    const selectedLinks = descendantElements(
      rows[0],
      (node) =>
        node.name === "a" &&
        nodeAttribute(node, "target") === "_blank" &&
        /^\/(?!\/)/u.test(nodeAttribute(node, "href") ?? ""),
    );
    if (selectedLinks.length === 0) return null;
    return normalizeUrlSelectorFixtureNode(wrapper);
  };
  const live = project(liveTopLevelWrappers[0]);
  const local = project(localTopLevelWrappers[0]);
  return live !== null && local !== null &&
    JSON.stringify(live) === JSON.stringify(local)
    ? { perPage: 250 }
    : null;
}

function importedPageIncludeTargets(source) {
  return [...source.matchAll(
    /\[\[(?:%%content\{[0-9]+\}%%)?include\s+:(?:[^\s:\]]+:)?(?<page>[^|\]\s\r\n]+)(?=\s*(?:\r?\n|\||\]\]))/giu,
  )].map((match) => match.groups.page);
}

function synchronizedImportedIncludeFixtureProof({
  source,
  invocation,
  liveNodes,
  localNodes,
  localUnsupportedDiagnostic,
}) {
  if (localUnsupportedDiagnostic) return null;
  const includeTargets = importedPageIncludeTargets(source);
  if (includeTargets.length === 0) {
    return null;
  }
  const distinctIncludeTargets = [...new Set(includeTargets)];
  const localErrors = descendantElements(
    { type: "element", name: "root", children: localNodes },
    (node) => nodeHasClass(node, "error-block"),
  );
  const errorTargets = localErrors.flatMap((node) => {
    const match = /^Included page "(?<page>[^"]+)" does not exist \(/u.exec(
      nodeText(node).trim(),
    );
    return match === null ? [] : [match.groups.page];
  });
  const directRepeatedConditional =
    invocation !== null &&
    lastArgumentValue(invocation, "order")?.trim().toLowerCase() === "random" &&
    /^(?:@url\|)?1$/iu.test(
      lastArgumentValue(invocation, "limit")?.trim() ?? "",
    ) &&
    invocationExpectsWrapper(invocation) === false &&
    invocationUsesCombinedSections(invocation) &&
    distinctIncludeTargets.length === 1 &&
    includeTargets.length >= 2 &&
    /\[\[#ifexpr\b/iu.test(source) &&
    /\[\[(?:%%content\{[0-9]+\}%%)?include\s+:[^\s:\]]+:[^\s\]|]+/iu.test(source) &&
    errorTargets.length === 1 &&
    errorTargets[0] === distinctIncludeTargets[0] &&
    liveNodes.length === 1 &&
    liveNodes[0]?.type === "element" &&
    localNodes.length === 1 &&
    localNodes[0]?.type === "element" &&
    nodeHasClass(localNodes[0], "error-block") &&
    !["list-pages-box", "list-pages-item", "pager"].some((className) =>
      domHasClass(liveNodes, className) || domHasClass(localNodes, className)
    );
  if (directRepeatedConditional) {
    return {
      includeTargets: distinctIncludeTargets,
      mode: "repeated-conditional-direct",
    };
  }
  if (
    errorTargets.length !== distinctIncludeTargets.length ||
    JSON.stringify([...errorTargets].sort()) !==
      JSON.stringify([...distinctIncludeTargets].sort())
  ) {
    return null;
  }
  const liveOwned = outermostListPagesOwnedSubtrees(liveNodes);
  const localOwned = outermostListPagesOwnedSubtrees(localNodes);
  if (
    liveOwned.length !== localOwned.length + 1 ||
    localOwned.length === 0 ||
    JSON.stringify(liveOwned.slice(0, localOwned.length)) !==
      JSON.stringify(localOwned)
  ) {
    return null;
  }
  const importedWrapper = liveOwned.at(-1);
  if (
    importedWrapper?.type !== "element" ||
    (importedWrapper.children ?? []).some((child) => child.type === "element") ||
    descendantElements(
      importedWrapper,
      (node) => nodeHasClass(node, "list-pages-item") || nodeHasClass(node, "pager"),
    ).length > 0
  ) {
    return null;
  }
  return {
    includeTargets,
    mode: "wrapper",
    importedWrapper,
  };
}

function classifyMismatch(row, reference) {
  const source = reference.syntax_case.source;
  const liveText = row.live.visible_text;
  const localText = row.local?.visible_text ?? "";
  const liveHtml = reference.raw_html;
  const liveNodes = canonicalDom(liveHtml);
  const localNodes = localDom(row);
  const invocation = exactSingleInvocation(source);
  const liveTopLevelWrappers = topLevelNodesWithClass(
    liveNodes,
    "list-pages-box",
  );
  const localTopLevelWrappers = topLevelNodesWithClass(
    localNodes,
    "list-pages-box",
  );
  const liveHasListPages =
    domHasClass(liveNodes, "list-pages-box") ||
    domHasClass(liveNodes, "list-pages-item") ||
    domHasClass(liveNodes, "pager") ||
    resolvesTemplateVariables(source, liveText);
  const localHasListPages =
    domHasClass(localNodes, "list-pages-box") ||
    domHasClass(localNodes, "list-pages-item") ||
    domHasClass(localNodes, "pager") ||
    resolvesTemplateVariables(source, localText);
  const localPreservedModule =
    localText.includes("[[module ListPages") ||
    localText.includes("[[module\tListPages");
  const localUnsupportedDiagnostic =
    /\bTODO:\s*module\s+ListPages\b/iu.test(localText);
  const missingLineArgument =
    missingVisibleLineArgument(source, liveText, localText);
  const missingAuthoredSection = invocation !== null &&
      liveTopLevelWrappers.length === 1 &&
      localTopLevelWrappers.length === 1
    ? missingPlainAuthoredSection({
        invocation,
        liveWrapper: liveTopLevelWrappers[0],
        localWrapper: localTopLevelWrappers[0],
      })
    : null;

  if (literalContextKeepsListPagesInactive({
    row,
    reference,
    localNodes,
    localUnsupportedDiagnostic,
  })) {
    return {
      classification: "literal-context-nonexecution-parity",
      disposition: "none",
      rationale:
        "The context-preserving replay keeps ListPages inactive in both runtimes; unrelated code, HTML, typography, or whitespace differences remain outside the ListPages campaign.",
    };
  }
  if (literalContextHasExactListPagesExecution({
    row,
    liveNodes,
    localNodes,
    localUnsupportedDiagnostic,
  })) {
    return {
      classification: "literal-context-listpages-execution-parity",
      disposition: "none",
      rationale:
        "The complete canonical ListPages-owned subtree matches exactly in this context-preserving replay; the remaining DOM drift is outside ListPages ownership.",
    };
  }
  if (literalDocumentationKeepsListPagesInactive({
    source,
    liveText,
    localText,
    liveNodes,
    localNodes,
    localUnsupportedDiagnostic,
  })) {
    return {
      classification: "literal-documentation-nonexecution-parity",
      disposition: "none",
      rationale:
        "The source begins with an evidenced argumentless documentation opener, every complete ListPages opening remains visibly literal in both runtimes, neither runtime emits ListPages-owned DOM, and Wikijump emits no unsupported diagnostic; remaining preview drift is outside ListPages execution.",
    };
  }
  if (hasExactListPagesOwnedExecution({
    liveNodes,
    localNodes,
    localUnsupportedDiagnostic,
  })) {
    return {
      classification: "listpages-owned-execution-parity",
      disposition: "none",
      rationale:
        "The complete canonical ListPages-owned subtree matches exactly; all remaining DOM drift is outside ListPages ownership.",
    };
  }
  if (malformedDefaultRowsHaveExactListPagesShell({
    invocation,
    liveTopLevelWrappers,
    localTopLevelWrappers,
    localUnsupportedDiagnostic,
  })) {
    return {
      classification: "listpages-malformed-default-row-shell-parity",
      disposition: "none",
      rationale:
        "For the exact evidenced unterminated @@…[[/footnote]] opener, both runtimes emit one default ListPages wrapper with the identical ordered row-link/title and author/date shell for every selected page plus an identical pager. Remaining drift is confined to selected pages' nested non-ListPages rendering and the enclosing page's FTML output; this records ListPages ownership parity, not a complete preview match.",
      };
  }
  const relativeTemporalFixture = relativeTemporalFixtureProof({
    invocation,
    liveNodes,
    localNodes,
    liveTopLevelWrappers,
    localTopLevelWrappers,
  });
  if (
    relativeTemporalFixture !== null &&
    /%%(?:created_at|updated_at|created_by|name|title|title_linked|linked_title|link|fullname|rating|votes|children|content\{[0-9]+\})(?:\|[^\r\n]*)?%%/iu
      .test(invocation.body) &&
    !localUnsupportedDiagnostic
  ) {
    return {
      classification: "synchronized-relative-time-query-state",
      disposition: "none",
      rationale:
        `The ListPages ${relativeTemporalFixture.selector.name} selector uses the evidenced relative-time form (${relativeTemporalFixture.selector.value}); the captured live time window and local fixture clock differ, yielding ${relativeTemporalFixture.mode}.`,
      };
  }
  const urlSelectorFixture = urlSelectorFixtureProof({
    invocation,
    liveNodes,
    localNodes,
    liveTopLevelWrappers,
    localTopLevelWrappers,
  });
  if (urlSelectorFixture !== null && !localUnsupportedDiagnostic) {
    return {
      classification: "synchronized-url-selector-fixture-state",
      disposition: "none",
      rationale:
        `The exact created_at="@URL" ListPages selector uses perPage=${urlSelectorFixture.perPage}; both runtimes emit the same one-wrapper blockquote/pager shell and row element structure while the captured URL-selected page set differs between live and imported fixtures.`,
      };
  }
  const importedIncludeFixture = synchronizedImportedIncludeFixtureProof({
    source,
    invocation,
    liveNodes,
    localNodes,
    localUnsupportedDiagnostic,
  });
  if (importedIncludeFixture !== null) {
    return {
      classification: "synchronized-imported-include-state",
      disposition: "none",
      rationale: importedIncludeFixture.mode === "repeated-conditional-direct"
        ? `The random wrapper-free ListPages body repeats one namespaced imported include across conditional branches; Wikidot emits one direct imported subtree while the local fixture emits the exact missing-page error for that target, with no ListPages-owned DOM on either side.`
        : `The source includes ${importedIncludeFixture.includeTargets.length} distinct pages whose imported fixture is absent locally; local Wikijump emits the exact missing-page errors, while the common ListPages wrappers match and the live-only imported wrapper is empty of rows and pagination.`,
    };
  }
  const randomOrder = invocation === null
    ? null
    : lastArgumentValue(invocation, "order")?.trim().toLowerCase();
  const randomLimit = invocation === null
    ? null
    : lastArgumentValue(invocation, "limit")?.trim();
  const randomRedirectBody = invocation !== null &&
    /^\s*\[\[include\s+:snippets:redirect\s+url=%%link%%\]\]\s*$/iu
      .test(invocation.body);
  const liveRedirectIframes = liveTopLevelWrappers.length === 1
    ? descendantElements(
      liveTopLevelWrappers[0],
      (node) => node.name === "iframe" &&
        /^https:\/\/snippets\.(?:wdfiles\.com|files\.invalid)\/local--code\/code:iframe-redirect#http:\/\/sandbox-for-codex\.wikidot\.com\/[^\s]+$/u
          .test(nodeAttribute(node, "src") ?? ""),
    )
    : [];
  const localRedirectErrors = localTopLevelWrappers.length === 1
    ? descendantElements(
      localTopLevelWrappers[0],
      (node) => nodeHasClass(node, "error-block") &&
        nodeText(node).trim() === "Sorry, no match for the embedded content.",
    )
    : [];
  if (
    invocation !== null &&
    relativeTimeSelector(invocation) === null &&
    randomOrder === "random" &&
    /(?:^|\|)1$/u.test(randomLimit ?? "") &&
    randomRedirectBody &&
    liveText === "" &&
    localText === "Sorry, no match for the embedded content." &&
    liveTopLevelWrappers.length === 1 &&
    localTopLevelWrappers.length === 1 &&
    descendantElements(
      liveTopLevelWrappers[0],
      (node) => nodeHasClass(node, "list-pages-item"),
    ).length === 1 &&
    descendantElements(
      localTopLevelWrappers[0],
      (node) => nodeHasClass(node, "list-pages-item"),
    ).length === 1 &&
    liveRedirectIframes.length === 1 &&
    localRedirectErrors.length === 1 &&
      !localUnsupportedDiagnostic
  ) {
    return {
      classification: "unsynchronized-random-row-state",
      disposition: "none",
      rationale:
        "The exact one-row random redirect invocation selects different cached fixture pages: Wikidot emits its canonical snippets redirect iframe for one selected link while the local fixture's selected link resolves to the canonical no-match error. This is a selected-row data-state difference, not a deterministic ListPages query or renderer contract.",
    };
  }
  if (
    invocation !== null &&
    relativeTimeSelector(invocation) === null &&
    randomOrder === "random" &&
    /(?:^|\|)1$/u.test(randomLimit ?? "") &&
    /%%(?:size|link)%%/iu.test(invocation.body) &&
    liveText === localText &&
    liveHasListPages &&
    localHasListPages &&
    !localUnsupportedDiagnostic
  ) {
    return {
      classification: "unsynchronized-random-row-state",
      disposition: "none",
      rationale:
        "The exact one-row invocation orders randomly and exposes selected-page size or link state in its body. Both runtimes execute with identical visible output, but their independently cached random fixture selections cannot have comparable metadata DOM.",
      };
  }
  const randomTemplateKind = randomSelectedRowTemplateKind(invocation);
  const randomExpectedWrapper = invocation === null
    ? null
    : invocationExpectsWrapper(invocation);
  const randomLiveStructure = randomExpectedWrapper === null
    ? null
    : normalizeRandomSelectedRowState(liveNodes, randomExpectedWrapper);
  const randomLocalStructure = randomExpectedWrapper === null
    ? null
    : normalizeRandomSelectedRowState(localNodes, randomExpectedWrapper);
  if (
    randomTemplateKind !== null &&
    relativeTimeSelector(invocation) === null &&
    randomExpectedWrapper !== null &&
    liveHasListPages &&
    localHasListPages &&
    !localUnsupportedDiagnostic &&
    liveTopLevelWrappers.length === localTopLevelWrappers.length &&
    liveTopLevelWrappers.length > 0 &&
    JSON.stringify(randomLiveStructure) ===
      JSON.stringify(randomLocalStructure) &&
    JSON.stringify(liveNodes) !== JSON.stringify(localNodes)
  ) {
    return {
      classification: "unsynchronized-random-row-state",
      disposition: "none",
      rationale:
      `The random ListPages body is the evidenced ${randomTemplateKind} selected-row form; both runtimes have the same wrapper/row structure after replacing only row-substitution text and attributes, while their independently cached selected fixture rows differ.`,
    };
  }
  const randomDirectStructureMatches =
    randomTemplateKind !== null &&
    relativeTimeSelector(invocation) === null &&
    randomExpectedWrapper === false &&
    liveTopLevelWrappers.length === 0 &&
    localTopLevelWrappers.length === 0 &&
    !["list-pages-box", "list-pages-item", "pager"].some((className) =>
      domHasClass(liveNodes, className) || domHasClass(localNodes, className)
    ) &&
    liveNodes.length === 1 &&
    (localNodes.length === 0 || localNodes.length === 1) &&
    JSON.stringify(randomLiveStructure) ===
      JSON.stringify(randomLocalStructure) &&
    JSON.stringify(liveNodes) !== JSON.stringify(localNodes);
  if (randomDirectStructureMatches) {
    return {
      classification: "unsynchronized-random-row-state",
      disposition: "none",
      rationale:
        `The random wrapper-free ListPages body is the evidenced ${randomTemplateKind} selected-row form; both runtimes emit the same direct element structure after replacing only selected-row text and attributes, while the cached random row differs.`,
    };
  }
  const randomCssBranchFixture =
    invocation !== null &&
    relativeTimeSelector(invocation) === null &&
    randomTemplateKind === "size-branch" &&
    randomExpectedWrapper === false &&
    liveTopLevelWrappers.length === 0 &&
    localTopLevelWrappers.length === 0 &&
    liveNodes.length === 1 &&
    liveNodes[0]?.type === "element" &&
    nodeHasClass(liveNodes[0], "code") &&
    descendantElements(liveNodes[0], (node) => node.name === "pre").length === 1 &&
    nodeText(liveNodes[0]).trim().length > 0 &&
    (
      localNodes.length === 0 ||
      (
        localNodes.length === 1 &&
        localNodes[0]?.type === "element" &&
        nodeHasClass(localNodes[0], "code") &&
        descendantElements(localNodes[0], (node) => node.name === "pre").length === 1 &&
        nodeText(localNodes[0]).trim().length > 0
      )
    ) &&
    JSON.stringify(liveNodes) !== JSON.stringify(localNodes);
  if (randomCssBranchFixture) {
    return {
      classification: "unsynchronized-random-row-state",
      disposition: "none",
      rationale:
        "The wrapper-free random ListPages body is the evidenced generated CSS size-branch form. Wikidot selected a non-empty CSS code row while the local fixture selected either another code row or no row; the independently selected imported row changes only fixture data, not the ListPages query or renderer contract.",
    };
  }
  const importedAuthorNames = new Set([
    ...synchronizedImportedAuthorNames(liveNodes),
    ...synchronizedImportedAuthorNames(localNodes),
  ]);
  const liveAuthorFixture = normalizeSynchronizedRuntimeFixtures(
    liveNodes,
    { importedAuthorNames },
  );
  const localAuthorFixture = normalizeSynchronizedRuntimeFixtures(
    localNodes,
    { importedAuthorNames },
  );
  const liveAuthorPageExistence = normalizeSynchronizedImportedPageExistence(
    liveAuthorFixture.nodes,
  );
  const localAuthorPageExistence = normalizeSynchronizedImportedPageExistence(
    localAuthorFixture.nodes,
  );
  if (
    (liveAuthorFixture.state.importedAuthors > 0 ||
      localAuthorFixture.state.importedAuthors > 0) &&
    JSON.stringify(liveAuthorPageExistence.nodes) ===
      JSON.stringify(localAuthorPageExistence.nodes)
  ) {
    return {
      classification: "synchronized-imported-author-state",
      disposition: "none",
      rationale:
        "Visible row output and all non-provenance DOM match after normalizing only live printuser identities, their exact plain imported-name fallback, ODate metadata, and identical imported internal-link existence markers.",
    };
  }
  const liveLinkedTitle = normalizeSynchronizedLinkedTitleSpaces(
    liveAuthorFixture.nodes,
  );
  const localLinkedTitle = normalizeSynchronizedLinkedTitleSpaces(
    localAuthorFixture.nodes,
  );
  const sourceUsesLinkedTitle =
    /%%(?:title_linked|linked_title)%%/iu.test(source) ||
    /\[\*[ \t]*%%link%%[ \t]+%%title%%[ \t]*\]/iu.test(source);
  const sourceUsesComposedLinkedTitle =
    /\[\[\[[ \t]*%%link%%\/noredirect\/true[ \t]*\|[ \t]*%%title%%[ \t]*\]\]\]/iu
      .test(source);
  const linkedTitleTypography = sourceUsesLinkedTitle
    ? normalizeSynchronizedLinkedTitleTypography(
        liveLinkedTitle.nodes,
        localLinkedTitle.nodes,
      )
    : {
        live: liveLinkedTitle.nodes,
        local: localLinkedTitle.nodes,
        normalizedTitles: 0,
      };
  const liveComposedLinkedTitle = sourceUsesComposedLinkedTitle
    ? normalizeSynchronizedComposedLinkedTitles(linkedTitleTypography.live)
    : { nodes: linkedTitleTypography.live, normalizedTitles: 0 };
  const localComposedLinkedTitle = sourceUsesComposedLinkedTitle
    ? normalizeSynchronizedComposedLinkedTitles(linkedTitleTypography.local)
    : { nodes: linkedTitleTypography.local, normalizedTitles: 0 };
  if (
    (sourceUsesLinkedTitle || sourceUsesComposedLinkedTitle) &&
    (sourceUsesComposedLinkedTitle ||
      liveText === localText ||
      linkedTitleTypography.normalizedTitles > 0) &&
    liveLinkedTitle.normalizedSpaces +
        localLinkedTitle.normalizedSpaces +
        linkedTitleTypography.normalizedTitles +
        liveComposedLinkedTitle.normalizedTitles +
        localComposedLinkedTitle.normalizedTitles >
      0 &&
    JSON.stringify(liveComposedLinkedTitle.nodes) ===
      JSON.stringify(localComposedLinkedTitle.nodes)
  ) {
    return {
      classification: "synchronized-imported-page-title-state",
      disposition: "none",
      rationale:
        "The source uses ListPages linked-title substitution or the exact authored %%link%%/noredirect/true and %%title%% composition, and the complete DOM matches after normalizing only generated link text for identical page targets plus synchronized imported-author and ODate metadata.",
    };
  }
  const liveImportedPageExistence =
    normalizeSynchronizedImportedPageExistence(liveComposedLinkedTitle.nodes);
  const localImportedPageExistence =
    normalizeSynchronizedImportedPageExistence(localComposedLinkedTitle.nodes);
  if (
    liveText === localText &&
    liveImportedPageExistence.normalizedTargets +
        localImportedPageExistence.normalizedTargets >
      0 &&
    JSON.stringify(liveImportedPageExistence.nodes) ===
      JSON.stringify(localImportedPageExistence.nodes)
  ) {
    return {
      classification: "synchronized-imported-page-existence-state",
      disposition: "none",
      rationale:
        "Visible output and the complete DOM match after removing only an exact newpage class from identical internal links whose target existence differs between the synchronized live and imported fixtures.",
    };
  }
  const liveImportedFile = normalizeSynchronizedImportedFileOrigins(
    liveImportedPageExistence.nodes,
  );
  const localImportedFile = normalizeSynchronizedImportedFileOrigins(
    localImportedPageExistence.nodes,
  );
  if (
    liveText === localText &&
    liveImportedFile.normalizedOrigins +
        localImportedFile.normalizedOrigins >
      0 &&
    JSON.stringify(liveImportedFile.nodes) ===
      JSON.stringify(localImportedFile.nodes)
  ) {
    return {
      classification: "synchronized-imported-file-origin-state",
      disposition: "none",
      rationale:
        "The complete DOM and visible output match after mapping only identical imported local-file paths between the live Wikidot site origin and the fixture's reserved files.invalid origin, plus synchronized imported metadata.",
    };
  }
  const firstImageFixture = invocation !== null &&
      /(?:^|\r?\n)[ \t]*\[\[image[ \t]+:first\]\][ \t]*(?:\r?\n|$)/iu
        .test(invocation.body) &&
      /%%(?:title_linked|linked_title)%%/iu.test(invocation.body) &&
      !["no", "false", "0"].includes(
        lastArgumentValue(invocation, "separate")?.trim().toLowerCase() ?? "yes",
      )
    ? normalizeSynchronizedFirstImageFixture(
        liveImportedFile.nodes,
        localImportedFile.nodes,
      )
    : null;
  if (
    firstImageFixture !== null &&
    liveText === localText &&
    JSON.stringify(firstImageFixture.live) ===
      JSON.stringify(firstImageFixture.local)
  ) {
    return {
      classification: "synchronized-imported-first-image-state",
      disposition: "none",
      rationale:
        "The source uses the exact executable ListPages [[image :first]] row form, every selected row is identical, and the complete DOM matches after removing only a directly owned first-image node whose local-file page owner exactly matches that row link and whose counterpart fixture has no image record.",
    };
  }
  const liveSocialNonce = normalizeSynchronizedRuntimeFixtures(
    liveNodes,
    { normalizeSocialNonce: true },
  );
  const localSocialNonce = normalizeSynchronizedRuntimeFixtures(
    localNodes,
    { normalizeSocialNonce: true },
  );
  if (
    liveSocialNonce.state.socialWidgets > 0 &&
    liveSocialNonce.state.socialWidgets ===
      localSocialNonce.state.socialWidgets &&
    liveSocialNonce.state.socialScripts ===
      liveSocialNonce.state.socialWidgets &&
    localSocialNonce.state.socialScripts ===
      localSocialNonce.state.socialWidgets &&
    liveSocialNonce.state.invalidSocialWidgets === 0 &&
    localSocialNonce.state.invalidSocialWidgets === 0 &&
    JSON.stringify(liveSocialNonce.nodes) ===
      JSON.stringify(localSocialNonce.nodes)
  ) {
    return {
      classification: "canonical-social-widget-nonce",
      disposition: "none",
      rationale:
        "The complete canonical legacy social-widget DOM and script match; only Wikidot's per-render five-digit element nonce differs.",
    };
  }
  const liveFootnoteNonce = normalizeCanonicalFootnoteNonces(
    liveImportedFile.nodes,
  );
  const localFootnoteNonce = normalizeCanonicalFootnoteNonces(
    localImportedFile.nodes,
  );
  if (
    liveText === localText &&
    liveFootnoteNonce.state.invalid === 0 &&
    localFootnoteNonce.state.invalid === 0 &&
    liveFootnoteNonce.state.references ===
      localFootnoteNonce.state.references &&
    JSON.stringify(liveFootnoteNonce.nodes) ===
      JSON.stringify(localFootnoteNonce.nodes)
  ) {
    return {
      classification: "canonical-footnote-route-nonce",
      disposition: "none",
      rationale:
        "The complete generated footnote reference/footer pairs and visible output match after synchronized imported metadata and exact imported local-file origin mapping; only Wikidot's consistent per-render numeric route nonce differs.",
    };
  }
  const tabviewSafety = /\[\[(?:tabs|tabview)(?:\s|\])/iu.test(source)
    ? compareTabviewSafetyPreservation(
      liveFootnoteNonce.state.invalid === 0
        ? liveFootnoteNonce.nodes
        : liveNodes,
      localFootnoteNonce.state.invalid === 0
        ? localFootnoteNonce.nodes
        : localNodes,
    )
    : null;
  if (
    tabviewSafety?.status === "safety-preservation" &&
    liveText === localText &&
    liveHasListPages &&
    localHasListPages &&
    !localUnsupportedDiagnostic
  ) {
    return {
      classification: "tabview-bootstrap-safety-preservation",
      disposition: "none",
      rationale:
        "The complete projected DOM and visible text match after only replacing Wikidot's exact per-instance legacy YUI loader and initializer with Wikijump's inert bootstrap placeholder. This is an intentional script-execution safety boundary, not an implementation-complete raw match.",
    };
  }
  const liveHtmlBlockNonce = normalizeSynchronizedRuntimeFixtures(
    liveNodes,
    { normalizeHtmlBlockNonce: true },
  );
  const localHtmlBlockNonce = normalizeSynchronizedRuntimeFixtures(
    localNodes,
    { normalizeHtmlBlockNonce: true },
  );
  if (
    liveHtmlBlockNonce.state.htmlBlocks > 0 &&
    liveHtmlBlockNonce.state.htmlBlocks ===
      localHtmlBlockNonce.state.htmlBlocks &&
    liveHtmlBlockNonce.state.invalidHtmlBlocks === 0 &&
    localHtmlBlockNonce.state.invalidHtmlBlocks === 0 &&
    JSON.stringify(liveHtmlBlockNonce.nodes) ===
      JSON.stringify(localHtmlBlockNonce.nodes)
  ) {
    return {
      classification: "canonical-html-block-route-nonce",
      disposition: "none",
      rationale:
        "The selected-page HTML iframe uses the canonical single-page route grammar and its exact SHA-1 content identity, attributes, and placement match; only the unsaved PagePreview request's page-route identity and per-render decimal nonce differ.",
    };
  }
  const liveFeaturedFixture = normalizeSynchronizedRuntimeFixtures(
    liveNodes,
    {
      normalizeFeaturedSite: true,
      normalizeSocialNonce: true,
      normalizeHtmlBlockNonce: true,
    },
  );
  const localFeaturedFixture = normalizeSynchronizedRuntimeFixtures(
    localNodes,
    {
      normalizeFeaturedSite: true,
      normalizeSocialNonce: true,
      normalizeHtmlBlockNonce: true,
    },
  );
  if (
    liveFeaturedFixture.state.featuredSites > 0 &&
    liveFeaturedFixture.state.featuredSites ===
      localFeaturedFixture.state.featuredSites &&
    liveFeaturedFixture.state.invalidFeaturedSites === 0 &&
    localFeaturedFixture.state.invalidFeaturedSites === 0 &&
    liveFeaturedFixture.state.socialWidgets ===
      localFeaturedFixture.state.socialWidgets &&
    liveFeaturedFixture.state.socialScripts ===
      liveFeaturedFixture.state.socialWidgets &&
    localFeaturedFixture.state.socialScripts ===
      localFeaturedFixture.state.socialWidgets &&
    liveFeaturedFixture.state.invalidSocialWidgets === 0 &&
    localFeaturedFixture.state.invalidSocialWidgets === 0 &&
    liveFeaturedFixture.state.htmlBlocks ===
      localFeaturedFixture.state.htmlBlocks &&
    liveFeaturedFixture.state.invalidHtmlBlocks === 0 &&
    localFeaturedFixture.state.invalidHtmlBlocks === 0 &&
    JSON.stringify(liveFeaturedFixture.nodes) ===
      JSON.stringify(localFeaturedFixture.nodes)
  ) {
    return {
      classification: "rotating-featured-site-state",
      disposition: "none",
      rationale:
        "Both runtimes emit the complete canonical FeaturedSite, legacy social-widget, and selected HTML-block structures; only the rotating live site record, synchronized local author provenance, and per-render social or iframe route nonces differ.",
    };
  }

  const exactErrors = new Map([
    ["Invalid range argument.", ["invalid-range-error", "fix"]],
    ["Invalid pagetype attribute.", ["invalid-pagetype-error", "fix"]],
    ["Invalid rating argument.", ["invalid-rating-error", "fix"]],
    ["Invalid votes argument.", ["invalid-votes-error", "fix"]],
  ]);
  if (exactErrors.has(liveText)) {
    const [classification, disposition] = exactErrors.get(liveText);
    return {
      classification,
      disposition,
      rationale: "Live Wikidot emits a deterministic ListPages argument error.",
    };
  }
  if (/^Parent page .+ does not exist$/u.test(liveText)) {
    return {
      classification: "missing-parent-error",
      disposition: "fix",
      rationale: "Live Wikidot resolves the static parent and reports that it does not exist.",
    };
  }
  if (missingLineArgument !== null) {
    return {
      classification: "prepend-append-line-divergence",
      disposition: "investigate-renderer",
      rationale:
        "Live Wikidot renders an authored prependLine or appendLine value that Wikijump omits.",
    };
  }
  if (missingAuthoredSection !== null) {
    return {
      classification: "listpages-section-template-divergence",
      disposition: "investigate-renderer",
      rationale:
        `Live Wikidot renders the authored ${missingAuthoredSection.section} section text that Wikijump omits.`,
    };
  }
  if (liveHasListPages && localUnsupportedDiagnostic) {
    return {
      classification: "local-listpages-unsupported-diagnostic",
      disposition: "investigate-renderer",
      rationale:
        "Live Wikidot executes ListPages while Wikijump emits its unsupported-module diagnostic.",
    };
  }
  if (
    !source.includes("[[/module]]") &&
    /\[\[module\s+ListPages\b[^\n]*\]\]/iu.test(source) &&
    liveHasListPages &&
    localPreservedModule
  ) {
    return {
      classification: "unclosed-listpages-body-parser-gap",
      disposition: "investigate-parser",
      rationale: "Live executes a complete ListPages opening head without a closing module tag.",
    };
  }
  if (liveHasListPages && localPreservedModule) {
    return {
      classification: "live-parser-accepts-local-preserves",
      disposition: "minimize-parser",
      rationale: "Live executes the module while Wikijump leaves its source literal.",
    };
  }
  if (
    invocation !== null &&
    invocationExpectsWrapper(invocation) === true &&
    liveHasListPages &&
    localHasListPages &&
    localOutputIsLiveOutputWithoutGeneratedWrapper(
      liveNodes,
      liveTopLevelWrappers,
      localNodes,
    )
  ) {
    return {
      classification: "listpages-render-shape-divergence",
      disposition: "investigate-renderer",
      rationale:
        "Live Wikidot and Wikijump disagree on the deterministic ListPages wrapper structure.",
    };
  }
  if (liveHasListPages && localHasListPages) {
    return {
      classification: "listpages-query-or-row-render-divergence",
      disposition: "investigate-query-or-renderer",
      rationale:
        "Both runtimes execute ListPages, but no synchronized-fixture proof explains the query result or rendered-row difference.",
    };
  }
  if (liveHasListPages) {
    return {
      classification: "listpages-render-shape-divergence",
      disposition: "investigate-renderer",
      rationale: "Live emits a ListPages container while the local canonical DOM does not.",
    };
  }
  return {
    classification: "other-preview-divergence",
    disposition: "investigate",
    rationale: "The preview mismatch is not explained by a known argument, parser, or fixture-state class.",
  };
}

export async function classifyListPagesPreviewDifferential({
  verdictPath,
  referencesPath,
  authoritative = false,
  observeRuntime = observeListPagesRuntimeAuthority,
  verdictData = null,
  referencesData = null,
}) {
  const verdictText = verdictData === null
    ? await fs.readFile(verdictPath, "utf8")
    : JSON.stringify(verdictData);
  const verdict = verdictData ?? JSON.parse(verdictText);
  const referencesText = referencesData ??
    await fs.readFile(referencesPath, "utf8");
  const references = readJsonlText(referencesText).map(validateWikidotReference);
  let authority = {
    mode: "diagnostic",
    completion_eligible: false,
  };
  if (authoritative) {
    if (
      verdict.inputs?.authority?.mode !== "authoritative" ||
      verdict.inputs.authority.completion_eligible !== true
    ) {
      throw new Error(
        "authoritative classification requires an authoritative preview verdict",
      );
    }
    if (verdict.inputs.references_sha256 !== sha256(referencesText)) {
      throw new Error("live references changed after the preview verdict");
    }
    const authorityArtifacts = {};
    for (const [kind, pathField, hashField] of [
      [
        "runtime identity",
        "runtime_identity_path",
        "runtime_identity_sha256",
      ],
      ["runtime proof", "runtime_proof_path", "runtime_proof_sha256"],
    ]) {
      const inputPath = verdict.inputs[pathField];
      const inputHash = verdict.inputs[hashField];
      if (
        typeof inputPath !== "string" ||
        !/^[0-9a-f]{64}$/u.test(inputHash ?? "")
      ) {
        throw new Error(`authoritative preview verdict has no ${kind} binding`);
      }
      const currentText = await fs.readFile(inputPath, "utf8");
      if (sha256(currentText) !== inputHash) {
        throw new Error(`${kind} changed after the preview verdict`);
      }
      authorityArtifacts[kind] = JSON.parse(currentText);
    }
    const runtimeIdentity = validateListPagesRuntimeIdentity(
      authorityArtifacts["runtime identity"],
    );
    const runtimeProof = validateListPagesRuntimeProof(
      authorityArtifacts["runtime proof"],
      runtimeIdentity,
    );
    const beforeObservation = validateListPagesRuntimeObservation(
      verdict.runtime_observations?.before,
      "before",
      runtimeIdentity,
      runtimeProof,
    );
    const afterObservation = validateListPagesRuntimeObservation(
      verdict.runtime_observations?.after,
      "after",
      runtimeIdentity,
      runtimeProof,
    );
    if (
      verdict.schema !== LISTPAGES_PREVIEW_DIFFERENTIAL_SCHEMA ||
      sha256(JSON.stringify(beforeObservation)) !==
        verdict.inputs.authority.runtime_observation_before_sha256 ||
      sha256(JSON.stringify(afterObservation)) !==
        verdict.inputs.authority.runtime_observation_after_sha256 ||
      beforeObservation.stable_sha256 !== afterObservation.stable_sha256 ||
      afterObservation.stable_sha256 !==
        verdict.inputs.authority.runtime_observation_stable_sha256 ||
      !/^[0-9a-f]{64}$/u.test(
        verdict.inputs.authority.runtime_observation_before_sha256 ?? "",
      ) ||
      !/^[0-9a-f]{64}$/u.test(
        verdict.inputs.authority.runtime_observation_after_sha256 ?? "",
      ) ||
      !/^[0-9a-f]{64}$/u.test(
        verdict.inputs.authority.runtime_observation_stable_sha256 ?? "",
      )
    ) {
      throw new Error("authoritative preview verdict schema or runtime observations are invalid");
    }
    const currentObservation = validateListPagesRuntimeObservation(
      await observeRuntime({
        identity: runtimeIdentity,
        proof: runtimeProof,
        phase: "classification",
      }),
      "classification",
      runtimeIdentity,
      runtimeProof,
    );
    if (currentObservation.stable_sha256 !== afterObservation.stable_sha256) {
      throw new Error(
        "authoritative runtime changed after the preview verdict",
      );
    }
    authority = {
      mode: "authoritative",
      completion_eligible: true,
      runtime_identity_sha256: verdict.inputs.runtime_identity_sha256,
      runtime_proof_sha256: verdict.inputs.runtime_proof_sha256,
      runtime_observation_stable_sha256:
        verdict.inputs.authority.runtime_observation_stable_sha256,
    };
  }
  const referenceIds = new Set();
  for (const reference of references) {
    const caseId = reference.syntax_case.case_id;
    if (referenceIds.has(caseId)) {
      throw new Error(`duplicate live reference case ID ${caseId}`);
    }
    referenceIds.add(caseId);
  }
  const referencesById = new Map(
    references.map((reference) => [reference.syntax_case.case_id, reference]),
  );
  if (!Array.isArray(verdict.cases)) {
    throw new Error("preview verdict cases must be an array");
  }
  const verdictIds = new Set();
  for (const row of verdict.cases) {
    if (verdictIds.has(row.case_id)) {
      throw new Error(`duplicate verdict case ID ${row.case_id}`);
    }
    verdictIds.add(row.case_id);
  }
  const missing = [...referenceIds].filter((caseId) => !verdictIds.has(caseId));
  const extra = [...verdictIds].filter((caseId) => !referenceIds.has(caseId));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      [
        "verdict/reference case IDs differ",
        missing.length > 0 ? `missing ${missing.join(", ")}` : null,
        extra.length > 0 ? `extra ${extra.join(", ")}` : null,
      ].filter(Boolean).join(": "),
    );
  }

  const cases = verdict.cases.map((row) => {
    const reference = referencesById.get(row.case_id);
    if (authoritative) {
      if (
        row.schema !== `${LISTPAGES_PREVIEW_DIFFERENTIAL_SCHEMA}.case` ||
        !["match", "mismatch", "local-error"].includes(row.status)
      ) {
        throw new Error(`authoritative verdict case ${row.case_id} is invalid`);
      }
      if (row.status !== "local-error") {
        if (
          typeof row.local?.raw_html !== "string" ||
          row.local.html_sha256 !== sha256(row.local.raw_html) ||
          row.local.visible_text !== visibleText(row.local.raw_html) ||
          row.live?.html_sha256 !== reference.raw_html_sha256 ||
          row.live.visible_text !== visibleText(reference.raw_html)
        ) {
          throw new Error(
            `authoritative verdict local or live output is invalid for ${row.case_id}`,
          );
        }
        const expectedComparison = compareListPagesPreviewHtml(
          reference,
          row.local.raw_html,
        );
        if (
          JSON.stringify(row.comparison) !== JSON.stringify(expectedComparison) ||
          row.status !== expectedComparison.status
        ) {
          throw new Error(
            `authoritative verdict comparison is invalid for ${row.case_id}`,
          );
        }
      }
    }
    const identities = row.comparison?.identities;
    if (
      identities?.source_sha256 === undefined ||
      identities?.live_html_sha256 === undefined
    ) {
      throw new Error(`verdict missing identity for ${row.case_id}`);
    }
    if (identities.source_sha256 !== reference.source_sha256) {
      throw new Error(`verdict source identity differs for ${row.case_id}`);
    }
    if (identities.live_html_sha256 !== reference.raw_html_sha256) {
      throw new Error(`verdict live HTML identity differs for ${row.case_id}`);
    }
    const result = row.status === "match"
      ? {
          classification: "matched",
          disposition: "none",
          rationale: "Canonical DOM and visible text match.",
        }
      : row.status === "local-error"
        ? {
            classification: "local-preview-error",
            disposition: "fix-or-block",
            rationale: row.error,
          }
        : classifyMismatch(row, reference);
    return {
      schema: `${LISTPAGES_PREVIEW_CLASSIFICATION_SCHEMA}.case`,
      case_id: row.case_id,
      source: reference.syntax_case.source,
      source_sha256: reference.source_sha256,
      differential_status: row.status,
      live_html_sha256: reference.raw_html_sha256,
      local_html_sha256: row.local?.html_sha256 ?? null,
      ...result,
    };
  });

  const counts = {};
  const dispositions = {};
  for (const row of cases) {
    counts[row.classification] = (counts[row.classification] ?? 0) + 1;
    dispositions[row.disposition] = (dispositions[row.disposition] ?? 0) + 1;
  }
  if (authoritative) {
    const verdictCounts = {};
    for (const row of verdict.cases) {
      verdictCounts[row.status] = (verdictCounts[row.status] ?? 0) + 1;
    }
    const expectedExitCode =
      (verdictCounts.mismatch ?? 0) > 0 ||
        (verdictCounts["local-error"] ?? 0) > 0
        ? 1
        : 0;
    if (
      verdict.summary?.total !== verdict.cases.length ||
      JSON.stringify(verdict.summary.counts) !== JSON.stringify(verdictCounts) ||
      verdict.summary.exit_code !== expectedExitCode
    ) {
      throw new Error("authoritative preview verdict summary is invalid");
    }
  }
  return {
    schema: LISTPAGES_PREVIEW_CLASSIFICATION_SCHEMA,
    generated_at: new Date().toISOString(),
    inputs: {
      verdict_path: verdictPath,
      verdict_sha256: sha256(verdictText),
      references_path: referencesPath,
      references_sha256: sha256(referencesText),
      authority,
    },
    cases,
    summary: {
      total: cases.length,
      classifications: counts,
      dispositions,
    },
  };
}

export async function writeListPagesPreviewClassification(
  classification,
  outputPath,
) {
  await publishListPagesJsonNoReplace(outputPath, classification);
}
