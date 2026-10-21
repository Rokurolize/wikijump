/**
 * Exact include-error marker shared by the corpus import dry-run and the
 * integrity verifier (issue #2093).
 *
 * The renderer emits missing includes as
 * `Included page "<page>" does not exist (...)` with a create-it-now link
 * (deepwell/src/services/render/include_resolution.rs,
 * `missing_include_message`, wrapped in a `[[div class="error-block"]]`
 * block). A loose `does not exist` substring also matches story prose
 * ("There does not exist a single mote...") and unrelated product
 * messages ("Requested forum category does not exist."), so affected and
 * fixed counts must use this exact marker instead.
 *
 * Observed compiled forms:
 * - entity-escaped: `Included page &quot;<page>&quot; does not exist`
 * - raw quotes: `Included page "<page>" does not exist`, as seen in DOM
 *   text content (entities decoded) and in wikitext source, where the
 *   message continues with ` ([[a ...` (the create-it-now link).
 */

export const INCLUDE_ERROR_TARGET_ENTITY_RE =
  /Included page &quot;((?:(?!&quot;)[^<])+?)&quot; does not exist/g;

export const INCLUDE_ERROR_TARGET_QUOTE_RE =
  /Included page "([^"\n]+?)" does not exist/g;

/**
 * Extract the distinct missing-include target page names from rendered
 * output, in first-seen order. Matches both compiled forms.
 */
export function findIncludeErrorTargets(rendered) {
  const targets = [];
  const seen = new Set();
  for (const pattern of [
    INCLUDE_ERROR_TARGET_ENTITY_RE,
    INCLUDE_ERROR_TARGET_QUOTE_RE,
  ]) {
    pattern.lastIndex = 0;
    for (const match of rendered.matchAll(pattern)) {
      const target = match[1];
      if (!seen.has(target)) {
        seen.add(target);
        targets.push(target);
      }
    }
  }
  return targets;
}

/** True when the rendered output carries at least one exact include error. */
export function hasIncludeError(rendered) {
  INCLUDE_ERROR_TARGET_ENTITY_RE.lastIndex = 0;
  INCLUDE_ERROR_TARGET_QUOTE_RE.lastIndex = 0;
  return (
    INCLUDE_ERROR_TARGET_ENTITY_RE.test(rendered) ||
    INCLUDE_ERROR_TARGET_QUOTE_RE.test(rendered)
  );
}

/**
 * SQL discovering every live page on a site whose latest compiled body
 * carries at least one exact include error. Postgres `~` regex replaces
 * the loose `LIKE '%does not exist%'`, which also matches story prose.
 * `[^<>]*` keeps the match on the message line without crossing markup.
 */
export function buildIncludeErrorRootsQuery(siteId) {
  if (!Number.isInteger(siteId)) {
    throw new Error("siteId must be an integer");
  }
  return `SELECT p.slug
FROM page p
JOIN page_revision r ON r.revision_id = p.latest_revision_id
JOIN text b ON b.hash = r.compiled_body_html_hash
WHERE p.site_id = ${siteId}
  AND p.deleted_at IS NULL
  AND b.contents ~ 'Included page (&quot;|")[^<>]*does not exist'
ORDER BY 1;`;
}

/**
 * SQL fetching latest rendered bodies for an explicit slug list, for
 * per-page include-error certification. Slugs are quote-escaped; an empty
 * list returns no rows.
 */
export function buildIncludeErrorBodiesQuery(siteId, slugs) {
  if (!Number.isInteger(siteId)) {
    throw new Error("siteId must be an integer");
  }
  const unique = [...new Set(slugs)];
  if (unique.length === 0) {
    throw new Error("at least one slug is required");
  }
  const values = unique
    .map((slug) => `('${String(slug).replace(/'/g, "''")}')`)
    .join(",\n  ");
  return `WITH requested(slug) AS (VALUES
  ${values}
)
SELECT requested.slug,
  COALESCE(convert_from(b.contents, 'UTF8'), '')
FROM requested
LEFT JOIN page p ON p.site_id = ${siteId} AND p.slug = requested.slug AND p.deleted_at IS NULL
LEFT JOIN page_revision r ON r.revision_id = p.latest_revision_id
LEFT JOIN text b ON b.hash = r.compiled_body_html_hash
ORDER BY requested.slug;`;
}

/**
 * Annotate a cross-site coverage report with exact include-error targets.
 *
 * `bodiesOutput` is the pipe-separated output of
 * `buildIncludeErrorBodiesQuery` (`slug|body`). Pages already expected to
 * be broken (unresolved gaps, truncated closure, or unmaterialized rows)
 * keep their errors as informational `include_error_targets`. A page
 * expected clean that still renders an exact include error becomes a
 * failure, since the closure claims to have fixed it.
 */
export function annotateCoverageWithIncludeErrors(report, bodiesOutput) {
  const bodies = new Map();
  for (const line of bodiesOutput.split("\n").filter(Boolean)) {
    const separator = line.indexOf("|");
    if (separator === -1) {
      throw new Error("include-error body query returned a malformed row");
    }
    bodies.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const pages = report.pages.map((page) => {
    const targets = findIncludeErrorTargets(bodies.get(page.slug) ?? "");
    return { ...page, include_error_targets: targets };
  });
  const failures = [...report.failures];
  for (const page of pages) {
    const expectedBroken =
      (page.missing_dependency_count ?? 0) > 0 ||
      (page.gap_count ?? 0) > 0 ||
      (page.truncated_count ?? 0) > 0;
    if (!expectedBroken && page.include_error_targets.length > 0) {
      failures.push({
        slug: page.slug,
        reason: "unexpected_include_errors",
        targets: page.include_error_targets,
      });
    }
  }
  return { status: failures.length ? "fail" : "pass", pages, failures };
}
