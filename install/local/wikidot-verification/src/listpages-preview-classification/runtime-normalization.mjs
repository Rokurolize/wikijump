export function nodeHasClass(node, className) {
  return node?.attrs
    ?.find((attribute) => attribute.name === "class")
    ?.value.split(/\s+/u)
    .includes(className) ?? false;
}


export function nodeAttribute(node, name) {
  return node?.attrs?.find((attribute) => attribute.name === name)?.value ?? null;
}

export function nodeText(node) {
  if (node?.type === "text") return node.value;
  if (node?.type !== "element") return "";
  return (node.children ?? []).map(nodeText).join("");
}

export function descendantElements(node, predicate) {
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

export function normalizeCanonicalFootnoteNonces(nodes) {
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

export function synchronizedImportedAuthorNames(nodes) {
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

export function normalizeSynchronizedLinkedTitleSpaces(nodes) {
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

export function normalizeSynchronizedLinkedTitleTypography(liveNodes, localNodes) {
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

export function normalizeSynchronizedComposedLinkedTitles(nodes) {
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

export function normalizeSynchronizedImportedPageExistence(nodes) {
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

export function normalizeSynchronizedImportedFileOrigins(nodes) {
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

export function normalizeSynchronizedFirstImageFixture(liveNodes, localNodes) {
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

export function normalizeSynchronizedRuntimeFixtures(nodes, {
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

