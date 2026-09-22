// Pure CSS/selector/computed-style analysis helpers for the theme-lab.
//
// These functions do no I/O and no browser work, so they are unit-testable and
// deterministic. The browser side lives in `browser-lab.mjs`.

export function stripCssComments(cssText) {
  let out = "";
  let index = 0;
  let string = null;
  while (index < cssText.length) {
    const char = cssText[index];
    if (string !== null) {
      out += char;
      if (char === "\\") {
        out += cssText[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (char === string) string = null;
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      string = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === "/" && cssText[index + 1] === "*") {
      const end = cssText.indexOf("*/", index + 2);
      index = end === -1 ? cssText.length : end + 2;
      out += " ";
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

export function splitTopLevel(text, delimiter) {
  const parts = [];
  let current = "";
  let depth = 0;
  let string = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (string !== null) {
      current += char;
      if (char === "\\") {
        current += text[index + 1] ?? "";
        index += 1;
        continue;
      }
      if (char === string) string = null;
      continue;
    }
    if (char === '"' || char === "'") {
      string = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    if (char === delimiter && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

const NESTING_AT_RULES = new Set([
  "@media",
  "@supports",
  "@layer",
  "@container",
  "@scope",
  "@document",
]);

// Returns `{selector, atContext, prelude}` for every top-level style rule,
// recursing into conditional at-rules. Approximate but stable: it never
// evaluates, it only separates rule preludes from bodies.
export function parseStyleSheet(cssText) {
  const rules = [];
  const css = stripCssComments(cssText);

  const walk = (text, atContext) => {
    let index = 0;
    while (index < text.length) {
      while (index < text.length && /\s/u.test(text[index])) index += 1;
      if (index >= text.length) return;
      const start = index;
      let cursor = index;
      let depth = 0;
      let string = null;
      for (; cursor < text.length; cursor += 1) {
        const char = text[cursor];
        if (string !== null) {
          if (char === "\\") cursor += 1;
          else if (char === string) string = null;
          continue;
        }
        if (char === '"' || char === "'") string = char;
        else if (char === "(" || char === "[") depth += 1;
        else if (char === ")" || char === "]") depth -= 1;
        else if (depth === 0 && (char === "{" || char === ";")) break;
      }
      if (cursor >= text.length) return;
      const prelude = text.slice(start, cursor).trim();
      if (text[cursor] === ";") {
        index = cursor + 1;
        continue;
      }
      const bodyStart = cursor + 1;
      let close = bodyStart;
      let inner = 1;
      let bodyString = null;
      for (; close < text.length; close += 1) {
        const char = text[close];
        if (bodyString !== null) {
          if (char === "\\") close += 1;
          else if (char === bodyString) bodyString = null;
          continue;
        }
        if (char === '"' || char === "'") bodyString = char;
        else if (char === "{") inner += 1;
        else if (char === "}") {
          inner -= 1;
          if (inner === 0) break;
        }
      }
      const body = text.slice(bodyStart, close);
      if (prelude.startsWith("@")) {
        const name = prelude.split(/[\s({]/u)[0].toLowerCase();
        if (NESTING_AT_RULES.has(name)) walk(body, [...atContext, prelude]);
      } else {
        for (const selector of splitTopLevel(prelude, ",")) {
          const trimmed = selector.trim();
          if (trimmed) rules.push({selector: trimmed, atContext: [...atContext], prelude});
        }
      }
      index = close + 1;
    }
  };

  walk(css, []);
  return rules;
}

export function collectSelectorTexts(rules) {
  const seen = new Set();
  const selectors = [];
  for (const rule of rules) {
    if (!rule || typeof rule.selector !== "string" || seen.has(rule.selector)) continue;
    seen.add(rule.selector);
    selectors.push(rule.selector);
  }
  return selectors;
}

// Rank reference selectors by how badly they are represented in the candidate.
export function rankSelectorDiffs({referenceRules, referenceCounts, candidateCounts}) {
  const referenceSelectors = collectSelectorTexts(referenceRules);
  const contextBySelector = new Map();
  for (const rule of referenceRules) {
    if (!contextBySelector.has(rule.selector)) contextBySelector.set(rule.selector, rule.atContext ?? []);
  }
  const rows = [];
  for (const selector of referenceSelectors) {
    const reference = referenceCounts?.[selector];
    const candidate = candidateCounts?.[selector];
    if (typeof reference !== "number" || typeof candidate !== "number") continue;
    let status;
    if (reference > 0 && candidate === 0) status = "missing";
    else if (reference === 0 && candidate > 0) status = "new";
    else if (reference !== candidate) status = "count_changed";
    else status = "match";
    rows.push({
      selector,
      at_context: contextBySelector.get(selector) ?? [],
      reference,
      candidate,
      delta: candidate - reference,
      status,
    });
  }
  const rank = {missing: 0, count_changed: 1, new: 2, match: 3};
  rows.sort((left, right) => {
    if (rank[left.status] !== rank[right.status]) return rank[left.status] - rank[right.status];
    return Math.abs(right.delta) - Math.abs(left.delta);
  });
  return rows;
}

// Only count selectors that the candidate fails to match at all, plus rules
// whose match count collapsed. This is the "first thing an LLM wants" list.
export function selectorDiagnosis(rows) {
  const missing = rows.filter((row) => row.status === "missing");
  const collapsed = rows.filter(
    (row) => row.status === "count_changed" && row.reference > 0 && row.candidate / row.reference <= 0.5,
  );
  const expanded = rows.filter(
    (row) => row.status === "count_changed" && row.reference > 0 && row.candidate / row.reference >= 2,
  );
  return {
    reference_selector_count: rows.length,
    missing_count: missing.length,
    collapsed_count: collapsed.length,
    expanded_count: expanded.length,
    missing,
    collapsed,
    expanded,
  };
}

function numericValue(value) {
  const match = String(value).match(/^(-?\d+(?:\.\d+)?)([a-z%]*)$/u);
  if (!match) return null;
  return {number: Number.parseFloat(match[1]), unit: match[2]};
}

export function diffComputedStyles({reference, candidate, properties}) {
  const rows = [];
  const anchors = new Set([...Object.keys(reference ?? {}), ...Object.keys(candidate ?? {})]);
  for (const anchor of anchors) {
    const ref = reference?.[anchor];
    const cand = candidate?.[anchor];
    if (!ref || !cand) {
      rows.push({
        anchor,
        property: "<element>",
        reference: ref ? "present" : "absent",
        candidate: cand ? "present" : "absent",
        delta: null,
        status: "element_presence",
      });
      continue;
    }
    for (const property of properties) {
      const refValue = ref.style?.[property] ?? "";
      const candValue = cand.style?.[property] ?? "";
      if (refValue === candValue) continue;
      const refNumber = numericValue(refValue);
      const candNumber = numericValue(candValue);
      const numeric =
        refNumber && candNumber && refNumber.unit === candNumber.unit
          ? candNumber.number - refNumber.number
          : null;
      rows.push({
        anchor,
        property,
        reference: refValue,
        candidate: candValue,
        delta: numeric,
        status: numeric === null ? "value_diff" : "numeric_delta",
      });
    }
    for (const dimension of ["x", "y", "width", "height"]) {
      const refValue = ref.rect?.[dimension];
      const candValue = cand.rect?.[dimension];
      if (typeof refValue !== "number" || typeof candValue !== "number" || refValue === candValue) continue;
      rows.push({
        anchor,
        property: `rect.${dimension}`,
        reference: refValue,
        candidate: candValue,
        delta: candValue - refValue,
        status: "geometry_delta",
      });
    }
  }
  rows.sort((left, right) => {
    const leftMagnitude = Math.abs(left.delta ?? Number.NEGATIVE_INFINITY);
    const rightMagnitude = Math.abs(right.delta ?? Number.NEGATIVE_INFINITY);
    if (leftMagnitude !== rightMagnitude) return rightMagnitude - leftMagnitude;
    return `${left.anchor}:${left.property}`.localeCompare(`${right.anchor}:${right.property}`);
  });
  return rows;
}

export function summarizeComputedStyleDiffs(rows) {
  const byStatus = {};
  for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  const byAnchor = {};
  for (const row of rows) byAnchor[row.anchor] = (byAnchor[row.anchor] ?? 0) + 1;
  return {
    total: rows.length,
    by_status: byStatus,
    by_anchor: byAnchor,
    top: rows.slice(0, 40),
  };
}
