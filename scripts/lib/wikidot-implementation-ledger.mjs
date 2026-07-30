import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const WIKIDOT_IMPLEMENTATION_LEDGER_SCHEMA =
  "wikijump.wikidot_implementation_ledger.v2";

export const WIKIDOT_PROPERTY_AXES = Object.freeze({
  P1: "invocation grammar and scalar interpretation",
  P2: "parser stage, nesting, and composition",
  P3: "lifecycle, persistence, import, and round trips",
  P4: "actors, permissions, visibility, and privacy",
  P5: "selection, ordering, counting, and pagination",
  P6: "HTTP, API, URL, Ajax, feed, and navigation contracts",
  P7: "DOM, CSS, resources, interaction, and geometry",
  P8: "temporal behavior, failure atomicity, limits, and resource bounds",
});

const FEATURE_STATUSES = new Set([
  "pending",
  "in_progress",
  "implemented",
  "blocked",
]);
const PROPERTY_STATUSES = new Set([
  "evidence_backed",
  "documentation_only",
  "unobserved",
  "blocked",
  "not_applicable",
]);
const TERMINAL_PROPERTY_STATUSES = new Set([
  "evidence_backed",
  "not_applicable",
]);
const PUBLIC_REGRESSION_TEST_ROOTS = [
  "deepwell/tests/",
  "framerail/tests/",
  "install/local/wikidot-verification/tests/",
  "install/standing/tests/",
  "wws/tests/",
];

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function sameStringSet(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function validateStringArray(value, fieldName) {
  invariant(Array.isArray(value), `${fieldName} must be an array`);
  invariant(
    value.every(
      (item) =>
        typeof item === "string" &&
        item.length > 0 &&
        item.trim() === item,
    ),
    `${fieldName} must contain non-empty, trimmed strings`,
  );
}

function maskRustCommentsAndStrings(source) {
  const output = [];
  let index = 0;
  let blockCommentDepth = 0;

  const mask = (value) => {
    for (const character of value) {
      output.push(character === "\n" ? "\n" : " ");
    }
  };

  while (index < source.length) {
    if (blockCommentDepth > 0) {
      if (source.startsWith("/*", index)) {
        mask("/*");
        blockCommentDepth += 1;
        index += 2;
      } else if (source.startsWith("*/", index)) {
        mask("*/");
        blockCommentDepth -= 1;
        index += 2;
      } else {
        mask(source[index]);
        index += 1;
      }
      continue;
    }

    if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      mask(source.slice(index, stop));
      index = stop;
      continue;
    }
    if (source.startsWith("/*", index)) {
      mask("/*");
      blockCommentDepth = 1;
      index += 2;
      continue;
    }

    const rawStringMatch = /^(?:b?r)(#*)"/u.exec(source.slice(index));
    if (rawStringMatch !== null) {
      const opening = rawStringMatch[0];
      const closing = `"${rawStringMatch[1]}`;
      const closingIndex = source.indexOf(closing, index + opening.length);
      const stop =
        closingIndex === -1
          ? source.length
          : closingIndex + closing.length;
      mask(source.slice(index, stop));
      index = stop;
      continue;
    }

    const stringPrefix = source.startsWith('b"', index) ? 'b"' : '"';
    if (source.startsWith(stringPrefix, index)) {
      const start = index;
      index += stringPrefix.length;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += Math.min(2, source.length - index);
        } else if (source[index] === '"') {
          index += 1;
          break;
        } else {
          index += 1;
        }
      }
      mask(source.slice(start, index));
      continue;
    }

    output.push(source[index]);
    index += 1;
  }

  return output.join("");
}

function extractRustTestDeclarations(source) {
  const declarations = new Set();
  const lines = maskRustCommentsAndStrings(source).split(/\r?\n/u);
  let pendingAttributes = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const attribute = /^#\[\s*([^\]]+)\s*\]$/u.exec(trimmed);
    if (attribute !== null) {
      pendingAttributes.push(attribute[1].trim());
      continue;
    }
    if (trimmed.length === 0) {
      continue;
    }

    const declaration = /^(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/u.exec(
      trimmed,
    );
    const hasTestAttribute = pendingAttributes.some((value) =>
      /^(?:(?:tokio|async_std)::)?test(?:\s*\(|$)/u.test(value),
    );
    const hasInactiveAttribute = pendingAttributes.some((value) =>
      /^(?:ignore|cfg|cfg_attr)(?:\s*\(|\s*=|$)/u.test(value),
    );
    if (
      declaration !== null &&
      hasTestAttribute &&
      !hasInactiveAttribute
    ) {
      declarations.add(declaration[1]);
    }
    pendingAttributes = [];
  }

  return declarations;
}

function skipJavaScriptWhitespaceAndComments(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/u.test(source[index])) {
      index += 1;
    } else if (source.startsWith("//", index)) {
      const end = source.indexOf("\n", index + 2);
      index = end === -1 ? source.length : end + 1;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      index = end === -1 ? source.length : end + 2;
    } else {
      break;
    }
  }
  return index;
}

function readJavaScriptStringLiteral(source, start) {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") {
    return null;
  }

  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === quote) {
      return { end: index + 1, value };
    }
    if (character === "\n" || character === "\r") {
      return null;
    }
    if (character !== "\\") {
      value += character;
      index += 1;
      continue;
    }

    index += 1;
    if (index >= source.length) {
      return null;
    }
    const escaped = source[index];
    const simpleEscapes = {
      "0": "\0",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    };
    if (Object.hasOwn(simpleEscapes, escaped)) {
      value += simpleEscapes[escaped];
      index += 1;
      continue;
    }
    if (escaped === "x") {
      const hex = source.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/u.test(hex)) {
        return null;
      }
      value += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }
    if (escaped === "u") {
      const unicode = /^\{([0-9A-Fa-f]{1,6})\}/u.exec(
        source.slice(index + 1),
      );
      if (unicode !== null) {
        value += String.fromCodePoint(Number.parseInt(unicode[1], 16));
        index += unicode[0].length + 1;
        continue;
      }
      const hex = source.slice(index + 1, index + 5);
      if (!/^[0-9A-Fa-f]{4}$/u.test(hex)) {
        return null;
      }
      value += String.fromCodePoint(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    value += escaped;
    index += 1;
  }
  return null;
}

function findMatchingJavaScriptDelimiter(source, start, opening, closing) {
  invariant(source[start] === opening, "Delimiter scan must start at opening token");
  let depth = 1;
  let index = start + 1;
  let state = "normal";

  while (index < source.length) {
    const character = source[index];
    if (state === "line-comment") {
      if (character === "\n") {
        state = "normal";
      }
      index += 1;
      continue;
    }
    if (state === "block-comment") {
      if (source.startsWith("*/", index)) {
        state = "normal";
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (state === "single-string" || state === "double-string") {
      const quote = state === "single-string" ? "'" : '"';
      if (character === "\\") {
        index += Math.min(2, source.length - index);
      } else {
        if (character === quote) {
          state = "normal";
        }
        index += 1;
      }
      continue;
    }
    if (state === "template-string") {
      if (character === "\\") {
        index += Math.min(2, source.length - index);
      } else {
        if (character === "`") {
          state = "normal";
        }
        index += 1;
      }
      continue;
    }

    if (source.startsWith("//", index)) {
      state = "line-comment";
      index += 2;
    } else if (source.startsWith("/*", index)) {
      state = "block-comment";
      index += 2;
    } else if (character === "'") {
      state = "single-string";
      index += 1;
    } else if (character === '"') {
      state = "double-string";
      index += 1;
    } else if (character === "`") {
      state = "template-string";
      index += 1;
    } else if (character === opening) {
      depth += 1;
      index += 1;
    } else if (character === closing) {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return index;
      }
    } else {
      index += 1;
    }
  }

  return null;
}

function hasJavaScriptTestCallback(source, start) {
  let index = skipJavaScriptWhitespaceAndComments(source, start);
  if (/^async\b/u.test(source.slice(index))) {
    index = skipJavaScriptWhitespaceAndComments(source, index + "async".length);
  }

  if (/^function\b/u.test(source.slice(index))) {
    index = skipJavaScriptWhitespaceAndComments(
      source,
      index + "function".length,
    );
    if (source[index] === "*") {
      index = skipJavaScriptWhitespaceAndComments(source, index + 1);
    }
    const functionName = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(
      source.slice(index),
    );
    if (functionName !== null) {
      index = skipJavaScriptWhitespaceAndComments(
        source,
        index + functionName[0].length,
      );
    }
    return source[index] === "(";
  }

  if (source[index] === "(") {
    const end = findMatchingJavaScriptDelimiter(source, index, "(", ")");
    if (end === null) {
      return false;
    }
    index = skipJavaScriptWhitespaceAndComments(source, end);
  } else if (source[index] === "{") {
    const end = findMatchingJavaScriptDelimiter(source, index, "{", "}");
    if (end === null) {
      return false;
    }
    index = skipJavaScriptWhitespaceAndComments(source, end);
  } else if (source[index] === "[") {
    const end = findMatchingJavaScriptDelimiter(source, index, "[", "]");
    if (end === null) {
      return false;
    }
    index = skipJavaScriptWhitespaceAndComments(source, end);
  } else {
    const parameter = /^[A-Za-z_$][A-Za-z0-9_$]*/u.exec(
      source.slice(index),
    );
    if (parameter === null) {
      return false;
    }
    index = skipJavaScriptWhitespaceAndComments(
      source,
      index + parameter[0].length,
    );
  }

  return source.startsWith("=>", index);
}

function parseJavaScriptTestDeclaration(source, start) {
  const identifier = /^(?:test|it)\b/u.exec(source.slice(start));
  if (identifier === null) {
    return null;
  }
  let index = skipJavaScriptWhitespaceAndComments(
    source,
    start + identifier[0].length,
  );

  if (source[index] === ".") {
    return null;
  }
  if (source[index] !== "(") {
    return null;
  }
  index = skipJavaScriptWhitespaceAndComments(source, index + 1);
  const title = readJavaScriptStringLiteral(source, index);
  if (
    title === null ||
    title.value.length === 0 ||
    title.value.trim() !== title.value
  ) {
    return null;
  }
  index = skipJavaScriptWhitespaceAndComments(source, title.end);
  if (source[index] !== ",") {
    return null;
  }
  if (!hasJavaScriptTestCallback(source, index + 1)) {
    return null;
  }
  return title.value;
}

function extractJavaScriptTestDeclarations(source) {
  const declarations = new Set();
  let index = 0;
  let state = "normal";
  let lineHasCode = false;

  while (index < source.length) {
    const character = source[index];
    if (state === "line-comment") {
      if (character === "\n") {
        state = "normal";
        lineHasCode = false;
      }
      index += 1;
      continue;
    }
    if (state === "block-comment") {
      if (source.startsWith("*/", index)) {
        state = "normal";
        index += 2;
      } else {
        if (character === "\n") {
          lineHasCode = false;
        }
        index += 1;
      }
      continue;
    }
    if (state === "single-string" || state === "double-string") {
      const quote = state === "single-string" ? "'" : '"';
      if (character === "\\") {
        index += Math.min(2, source.length - index);
      } else {
        if (character === quote) {
          state = "normal";
        }
        if (character === "\n") {
          lineHasCode = false;
        }
        index += 1;
      }
      continue;
    }
    if (state === "template-string") {
      if (character === "\\") {
        index += Math.min(2, source.length - index);
      } else {
        if (character === "`") {
          state = "normal";
        }
        if (character === "\n") {
          lineHasCode = false;
        }
        index += 1;
      }
      continue;
    }

    if (character === "\n") {
      lineHasCode = false;
      index += 1;
      continue;
    }
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (source.startsWith("//", index)) {
      state = "line-comment";
      index += 2;
      continue;
    }
    if (source.startsWith("/*", index)) {
      state = "block-comment";
      index += 2;
      continue;
    }
    if (character === "'") {
      state = "single-string";
      lineHasCode = true;
      index += 1;
      continue;
    }
    if (character === '"') {
      state = "double-string";
      lineHasCode = true;
      index += 1;
      continue;
    }
    if (character === "`") {
      state = "template-string";
      lineHasCode = true;
      index += 1;
      continue;
    }

    if (!lineHasCode && /[A-Za-z_$]/u.test(character)) {
      const declaration = parseJavaScriptTestDeclaration(source, index);
      if (declaration !== null) {
        declarations.add(declaration);
      }
    }
    lineHasCode = true;
    index += 1;
  }

  return declarations;
}

function extractDeclaredPublicTests(relativePath, source) {
  if (relativePath.endsWith(".rs")) {
    return extractRustTestDeclarations(source);
  }
  if (/\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/u.test(relativePath)) {
    return extractJavaScriptTestDeclarations(source);
  }
  return null;
}

function parseRepositoryEvidenceReference({
  evidence,
  prefix,
  featureId,
  axis,
  repositoryRoot,
  realRepositoryRoot,
  requirePublicTest,
  requireAnchor,
}) {
  const reference = evidence.slice(prefix.length);
  const anchorSeparator = reference.indexOf("#");
  const relativePath =
    anchorSeparator === -1
      ? reference
      : reference.slice(0, anchorSeparator);
  const anchor =
    anchorSeparator === -1 ? null : reference.slice(anchorSeparator + 1);
  const label = `${featureId}.${axis} ${prefix.slice(0, -1)} evidence`;

  invariant(relativePath.length > 0, `${label} has an empty path`);
  invariant(
    !isAbsolute(relativePath) && !relativePath.includes("\\"),
    `${label} path must be canonical and repository-relative: ${relativePath}`,
  );
  invariant(
    relativePath.split("/").every((segment) => {
      return segment.length > 0 && segment !== "." && segment !== "..";
    }),
    `${label} path must not contain empty or traversal segments: ${relativePath}`,
  );
  if (requireAnchor) {
    invariant(
      typeof anchor === "string" && anchor.length > 0,
      `${label} must name an exact test anchor: ${relativePath}`,
    );
  }
  if (requirePublicTest) {
    invariant(
      PUBLIC_REGRESSION_TEST_ROOTS.some((root) =>
        relativePath.startsWith(root),
      ),
      `${label} is not under a public regression test root: ${relativePath}`,
    );
  }

  const absolutePath = resolve(repositoryRoot, relativePath);
  const repositoryRelativePath = relative(repositoryRoot, absolutePath);
  invariant(
    repositoryRelativePath !== ".." &&
      !repositoryRelativePath.startsWith(`..${sep}`) &&
      !isAbsolute(repositoryRelativePath),
    `${label} escapes the repository: ${relativePath}`,
  );

  let fileStatus;
  let realPath;
  try {
    fileStatus = lstatSync(absolutePath);
    realPath = realpathSync(absolutePath);
  } catch {
    invariant(false, `${label} path does not exist: ${relativePath}`);
  }
  invariant(
    fileStatus.isFile() && !fileStatus.isSymbolicLink(),
    `${label} path must be a regular non-symlink file: ${relativePath}`,
  );
  const realRelativePath = relative(realRepositoryRoot, realPath);
  invariant(
    realRelativePath !== ".." &&
      !realRelativePath.startsWith(`..${sep}`) &&
      !isAbsolute(realRelativePath),
    `${label} resolves outside the repository: ${relativePath}`,
  );

  const source = anchor === null ? null : readFileSync(realPath, "utf8");
  if (requirePublicTest) {
    const declaredTests = extractDeclaredPublicTests(relativePath, source);
    invariant(
      declaredTests !== null,
      `${label} path is not a supported public test file: ${relativePath}`,
    );
    invariant(
      declaredTests.has(anchor),
      `${label} anchor is not a declared runnable test in ${relativePath}: ${anchor}`,
    );
  } else if (anchor !== null) {
    invariant(
      source.includes(anchor),
      `${label} anchor does not exist in ${relativePath}: ${anchor}`,
    );
  }

  return { anchor, relativePath };
}

export function validateWikidotImplementationLedger({
  ledger,
  rawCatalog,
  catalog,
  liveObservationIds,
  repositoryRoot,
}) {
  invariant(
    typeof repositoryRoot === "string" && isAbsolute(repositoryRoot),
    "Implementation ledger validation requires an absolute repository root",
  );
  const realRepositoryRoot = realpathSync(repositoryRoot);
  invariant(
    ledger.schema === WIKIDOT_IMPLEMENTATION_LEDGER_SCHEMA,
    "Unexpected implementation ledger schema",
  );
  const expectedCatalogSha256 = sha256(rawCatalog);
  invariant(
    ledger.catalog_sha256 === expectedCatalogSha256,
    `Implementation ledger catalog hash is stale; expected ${expectedCatalogSha256}`,
  );

  const catalogIds = catalog.features.map((feature) => feature.id).sort();
  const catalogIdSet = new Set(catalogIds);
  const liveObservationIdSet = new Set(liveObservationIds);
  const ledgerIds = sortedKeys(ledger.features);
  invariant(
    sameStringSet(ledgerIds, catalogIds),
    "Implementation ledger must contain exactly one entry per catalog feature",
  );

  invariant(
    JSON.stringify(ledger.property_axes) ===
      JSON.stringify(WIKIDOT_PROPERTY_AXES),
    "Implementation ledger property-axis definitions drifted",
  );
  invariant(
    ledger.feature_property_matrix !== null &&
      typeof ledger.feature_property_matrix === "object" &&
      !Array.isArray(ledger.feature_property_matrix),
    "Implementation ledger feature_property_matrix must be an object",
  );

  invariant(
    ledger.campaign !== null && typeof ledger.campaign === "object",
    "Implementation ledger campaign must be an object",
  );
  validateStringArray(
    ledger.campaign.requested_scope,
    "Implementation ledger campaign.requested_scope",
  );
  invariant(
    new Set(ledger.campaign.requested_scope).size ===
      ledger.campaign.requested_scope.length,
    "Implementation ledger campaign.requested_scope must not contain duplicates",
  );
  for (const featureId of ledger.campaign.requested_scope) {
    invariant(
      catalogIdSet.has(featureId),
      `Implementation ledger campaign scope references unknown feature ${featureId}`,
    );
    invariant(
      Object.hasOwn(ledger.feature_property_matrix, featureId),
      `Implementation ledger campaign feature ${featureId} has no P1-P8 property matrix`,
    );
  }

  for (const [featureId, entry] of Object.entries(ledger.features)) {
    invariant(
      FEATURE_STATUSES.has(entry.status),
      `Invalid ledger status for ${featureId}`,
    );
    for (const field of [
      "confirmed_public_seams",
      "tests",
      "implementation_files",
      "documentation_evidence",
      "live_oracle_evidence",
      "unresolved_ambiguities_or_blockers",
    ]) {
      invariant(
        Array.isArray(entry[field]),
        `Ledger field ${featureId}.${field} must be an array`,
      );
    }
  }

  const expectedAxes = sortedKeys(WIKIDOT_PROPERTY_AXES);
  for (const [featureId, matrix] of Object.entries(
    ledger.feature_property_matrix,
  )) {
    invariant(
      catalogIdSet.has(featureId),
      `Implementation ledger property matrix references unknown feature ${featureId}`,
    );
    invariant(
      matrix !== null && typeof matrix === "object" && !Array.isArray(matrix),
      `Implementation ledger property matrix for ${featureId} must be an object`,
    );
    invariant(
      sameStringSet(sortedKeys(matrix), expectedAxes),
      `Implementation ledger property matrix for ${featureId} must classify exactly P1-P8`,
    );

    for (const axis of expectedAxes) {
      const property = matrix[axis];
      invariant(
        property !== null &&
          typeof property === "object" &&
          !Array.isArray(property),
        `Implementation ledger property ${featureId}.${axis} must be an object`,
      );
      invariant(
        PROPERTY_STATUSES.has(property.status),
        `Invalid property status for ${featureId}.${axis}`,
      );
      validateStringArray(
        property.evidence,
        `Implementation ledger property ${featureId}.${axis}.evidence`,
      );
      validateStringArray(
        property.observation_gaps,
        `Implementation ledger property ${featureId}.${axis}.observation_gaps`,
      );

      for (const evidence of property.evidence) {
        if (evidence.startsWith("live:")) {
          const observationId = evidence.slice("live:".length);
          invariant(
            liveObservationIdSet.has(observationId),
            `Implementation ledger property ${featureId}.${axis} references unknown live observation ${observationId}`,
          );
        } else if (evidence.startsWith("test:")) {
          parseRepositoryEvidenceReference({
            evidence,
            prefix: "test:",
            featureId,
            axis,
            repositoryRoot,
            realRepositoryRoot,
            requirePublicTest: true,
            requireAnchor: true,
          });
        } else if (
          evidence.startsWith("artifact:") ||
          evidence.startsWith("docs:")
        ) {
          const prefix = evidence.startsWith("artifact:")
            ? "artifact:"
            : "docs:";
          parseRepositoryEvidenceReference({
            evidence,
            prefix,
            featureId,
            axis,
            repositoryRoot,
            realRepositoryRoot,
            requirePublicTest: false,
            requireAnchor: false,
          });
        }
      }

      if (property.status === "evidence_backed") {
        invariant(
          property.evidence.length > 0,
          `Evidence-backed property ${featureId}.${axis} has no durable evidence`,
        );
        invariant(
          property.evidence.some((evidence) => evidence.startsWith("live:")),
          `Evidence-backed property ${featureId}.${axis} has no live-Wikidot evidence`,
        );
        invariant(
          property.evidence.some((evidence) => evidence.startsWith("test:")),
          `Evidence-backed property ${featureId}.${axis} has no public regression seam`,
        );
        invariant(
          property.observation_gaps.length === 0,
          `Evidence-backed property ${featureId}.${axis} still has observation gaps`,
        );
      } else if (property.status === "not_applicable") {
        invariant(
          typeof property.rationale === "string" &&
            property.rationale.length > 0 &&
            property.rationale.trim() === property.rationale,
          `Not-applicable property ${featureId}.${axis} has no rationale`,
        );
        invariant(
          property.observation_gaps.length === 0,
          `Not-applicable property ${featureId}.${axis} still has observation gaps`,
        );
      } else {
        invariant(
          property.observation_gaps.length > 0,
          `Non-terminal property ${featureId}.${axis} must name its observation gap`,
        );
      }
    }

    if (ledger.features[featureId].status === "implemented") {
      invariant(
        ledger.features[featureId].unresolved_ambiguities_or_blockers.length ===
          0,
        `Implemented feature ${featureId} still has unresolved ambiguities or blockers`,
      );
      for (const axis of expectedAxes) {
        invariant(
          TERMINAL_PROPERTY_STATUSES.has(matrix[axis].status),
          `Implemented feature ${featureId} has non-terminal property ${axis}: ${matrix[axis].status}`,
        );
      }
    }
  }
}
