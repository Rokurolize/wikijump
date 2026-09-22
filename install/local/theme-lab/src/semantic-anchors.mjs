// Semantic anchoring between a foreign reference DOM and the SCP-JP DOM.
//
// A foreign selector that matches zero candidate elements is the most common
// theme-port failure. Instead of only reporting "missing", classify what the
// reference element *was* and propose the SCP-JP element(s) that fill the same
// role, with evidence and a confidence score. It never rewrites CSS by itself.

export const SEMANTIC_ANCHORS = Object.freeze([
  {role: "page_root", selectors: ["#container", "#main-content", "#content-wrap"]},
  {role: "header", selectors: ["#header", ".site-header", "header#header"]},
  {role: "site_title", selectors: ["#header h1", "#header .title", ".site-title"]},
  {role: "page_title", selectors: ["#page-title", ".page-title"]},
  {role: "page_content", selectors: ["#page-content", ".page-content"]},
  {role: "side_bar", selectors: ["#side-bar", ".side-bar", "#sidebar"]},
  {role: "rating_widget", selectors: [".page-rate-widget-box", ".rate-box", "#rating-module"]},
  {role: "table", selectors: ["table.wiki-content-table", "#page-content table"]},
  {role: "blockquote", selectors: ["#page-content blockquote", "blockquote"]},
  {role: "code", selectors: ["#page-content .code", "pre.code", "#page-content pre"]},
  {role: "tabview", selectors: [".yui-navset", "#page-content .yui-navset"]},
  {role: "collapsible", selectors: [".collapsible-block", "details.collapsible-block"]},
  {role: "footnote", selectors: [".footnotes-footer", ".footnoteref"]},
  {role: "toc", selectors: ["#toc", ".toc"]},
  {role: "image_block", selectors: [".scp-image-block", ".image-block"]},
  {role: "interwiki", selectors: ["iframe.scpnet-interwiki-frame"]},
  {role: "footer", selectors: ["#footer", ".footer"]},
]);

// Tokens that classify an element into a semantic role when it has no exact
// anchor. Order matters: the first matching role wins.
const ROLE_TOKENS = Object.freeze([
  {role: "rating_widget", tokens: ["rate", "rating", "vote"]},
  {role: "image_block", tokens: ["image-block", "scp-image", "image-container"]},
  {role: "tabview", tokens: ["yui-navset", "tabview", "tabs"]},
  {role: "collapsible", tokens: ["collapsible", "foldable"]},
  {role: "footnote", tokens: ["footnote"]},
  {role: "toc", tokens: ["toc", "table-of-contents"]},
  {role: "side_bar", tokens: ["side-bar", "sidebar", "side_bar"]},
  {role: "page_title", tokens: ["page-title", "page_title"]},
  {role: "site_title", tokens: ["site-title", "site_title", "header-title"]},
  {role: "header", tokens: ["header"]},
  {role: "footer", tokens: ["footer"]},
  {role: "page_content", tokens: ["page-content", "page_content", "content-wrap"]},
  {role: "interwiki", tokens: ["interwiki"]},
]);

function tokenize(value) {
  return String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_-]+/u)
    .filter(Boolean);
}

export function classifyElement({tag = "", id = null, class: className = null} = {}) {
  const haystack = `${id ?? ""} ${className ?? ""}`.toLowerCase();
  const normalizedTag = tag.toLowerCase();
  if (!haystack.trim() && !normalizedTag) return null;

  // Exact semantic anchor selectors first.
  for (const anchor of SEMANTIC_ANCHORS) {
    for (const selector of anchor.selectors) {
      const simple = selector.trim().toLowerCase();
      if (simple.startsWith("#") && simple.slice(1) === (id ?? "").toLowerCase()) return anchor.role;
      if (simple.startsWith(".") && tokenize(className).includes(simple.slice(1))) return anchor.role;
      if (simple === normalizedTag) return anchor.role;
    }
  }
  for (const {role, tokens} of ROLE_TOKENS) {
    if (tokens.some((token) => haystack.includes(token))) return role;
  }
  if (normalizedTag === "blockquote") return "blockquote";
  if (normalizedTag === "table") return "table";
  return null;
}

function classSet(value) {
  return new Set(tokenize(value));
}

function overlapSize(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

export function scoreAnchorMatch(referenceInfo, candidateInfo) {
  const evidence = [];
  let score = 0;
  const referenceRole = referenceInfo.role ?? classifyElement(referenceInfo);
  const candidateRole = candidateInfo.role ?? classifyElement(candidateInfo);
  if (referenceRole && referenceRole === candidateRole) {
    score += 0.6;
    evidence.push("same semantic anchor");
  }
  if (referenceInfo.tag && referenceInfo.tag === candidateInfo.tag) {
    score += 0.15;
    evidence.push("same tag");
  }
  const referenceClasses = classSet(referenceInfo.class);
  const candidateClasses = classSet(candidateInfo.class);
  const shared = overlapSize(referenceClasses, candidateClasses);
  if (shared > 0) {
    score += Math.min(0.2, shared * 0.1);
    evidence.push("shared class");
  }
  if (referenceInfo.rect && candidateInfo.rect) {
    const refWidth = referenceInfo.rect.width;
    const candWidth = candidateInfo.rect.width;
    if (refWidth > 0 && candWidth > 0) {
      const ratio = Math.min(refWidth, candWidth) / Math.max(refWidth, candWidth);
      if (ratio >= 0.5) {
        score += 0.05;
        evidence.push("similar width");
      }
    }
  }
  return {confidence: Number(Math.min(1, score).toFixed(2)), evidence};
}

// Given a missing reference selector's element and a map of role -> candidate
// elements, return ranked candidate counterparts.
export function suggestCandidateAnchors(referenceInfo, candidateAnchorsByRole, {limit = 3} = {}) {
  const role = referenceInfo.role ?? classifyElement(referenceInfo);
  const suggestions = [];
  const consider = (elements, viaRole) => {
    for (const element of elements ?? []) {
      const {confidence, evidence} = scoreAnchorMatch(referenceInfo, {...element, role: viaRole});
      suggestions.push({
        selector: element.selector ?? null,
        role: viaRole,
        confidence,
        evidence,
        tag: element.tag,
        class: element.class,
      });
    }
  };
  if (role) {
    // The role is known. Only propose the candidate elements that fill it; if
    // the SCP-JP DOM has no such element, that absence is the finding.
    if (candidateAnchorsByRole[role]) consider(candidateAnchorsByRole[role], role);
  } else {
    // Unknown role: fall back to a high-confidence structural match only.
    for (const [candidateRole, elements] of Object.entries(candidateAnchorsByRole)) {
      consider(elements, candidateRole);
    }
  }
  suggestions.sort((left, right) => right.confidence - left.confidence);
  const floor = role ? 0.2 : 0.3;
  return suggestions.filter((entry) => entry.confidence >= floor).slice(0, limit);
}

export function anchorSelectors() {
  return SEMANTIC_ANCHORS.flatMap((anchor) => anchor.selectors);
}
