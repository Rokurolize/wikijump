import fs from "node:fs/promises";
import path from "node:path";

import {
  canonicalDom,
  sha256,
  validateWikidotReference,
} from "./syntax-differential.mjs";
import {
  extractListPagesInvocationsFromSource,
} from "./listpages-campaign-inventory.mjs";

export const LISTPAGES_PREVIEW_CLASSIFICATION_SCHEMA =
  "wikijump_listpages_compat.preview_classification.v1";

async function readJsonl(filePath) {
  const text = await fs.readFile(filePath, "utf8");
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
  const liveHtml = reference.raw_html;
  const liveExecuted = ["list-pages-box", "list-pages-item", "pager"]
    .some((className) =>
      liveHtml.includes(`class="${className}"`) ||
      liveHtml.includes(`class='${className}'`)
    );
  const localExecuted = ["list-pages-box", "list-pages-item", "pager"]
    .some((className) => domHasClass(localNodes, className));
  return !liveExecuted && !localExecuted && !localUnsupportedDiagnostic;
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
    liveHtml.includes('class="list-pages-item"') ||
    liveHtml.includes('class="pager"') ||
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
      classification: "inconclusive-fixture-data-state",
      disposition: "replay-synchronized-fixture",
      rationale: "Both runtimes execute ListPages, but the live and local sites contain different pages.",
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
}) {
  const verdictText = await fs.readFile(verdictPath, "utf8");
  const verdict = JSON.parse(verdictText);
  const referencesText = await fs.readFile(referencesPath, "utf8");
  const references = (await readJsonl(referencesPath)).map(validateWikidotReference);
  const referencesById = new Map(
    references.map((reference) => [reference.syntax_case.case_id, reference]),
  );

  const cases = verdict.cases.map((row) => {
    const reference = referencesById.get(row.case_id);
    if (!reference) {
      throw new Error(`missing live reference for ${row.case_id}`);
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

  if (cases.length !== references.length) {
    throw new Error(
      `verdict/reference case count differs: ${cases.length} != ${references.length}`,
    );
  }
  const counts = {};
  const dispositions = {};
  for (const row of cases) {
    counts[row.classification] = (counts[row.classification] ?? 0) + 1;
    dispositions[row.disposition] = (dispositions[row.disposition] ?? 0) + 1;
  }
  return {
    schema: LISTPAGES_PREVIEW_CLASSIFICATION_SCHEMA,
    generated_at: new Date().toISOString(),
    inputs: {
      verdict_path: verdictPath,
      verdict_sha256: sha256(verdictText),
      references_path: referencesPath,
      references_sha256: sha256(referencesText),
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
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(classification, null, 2)}\n`,
    { mode: 0o600 },
  );
}
