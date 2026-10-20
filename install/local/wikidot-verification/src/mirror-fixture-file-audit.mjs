/**
 * Read-only audit of synthetic or fixture file rows on Wikidot mirror
 * pages. Refs #2095.
 *
 * Mirror pages must show the source inventory. Rows that are neither
 * imported source rows nor genuine mirror-import inventory are fixture
 * leakage (for example the seeder's `SCP.txt`, whose planted bytes are
 * page source) and are repair candidates. Rows carrying the bulk
 * mirror-import provenance comment are genuine inventory and must never
 * be tombstoned by this audit.
 *
 * The classifier is pure: callers supply row objects (for example parsed
 * from a `psql -At` TSV dump) and a seed index built from
 * `deepwell/seeder/files.json`. Nothing here touches a database.
 */

export const MIRROR_IMPORT_COMMENT_PATTERN = /mirror attachment import/u;

function seedKey(siteSlug, pageSlug, name) {
  return `${siteSlug ?? ""}\u0000${pageSlug ?? ""}\u0000${name ?? ""}`;
}

/**
 * Index the seeder fixture by site, page, and file name.
 *
 * @param {object} seederFiles the parsed `deepwell/seeder/files.json`.
 * @returns {Map<string, {path: string|null, overwrite: string|null}>}
 */
export function buildSeedIndex(seederFiles) {
  const index = new Map();
  for (const [siteSlug, pages] of Object.entries(seederFiles ?? {})) {
    for (const [pageSlug, files] of Object.entries(pages ?? {})) {
      for (const file of files ?? []) {
        index.set(seedKey(siteSlug, pageSlug, file?.name), {
          path: file?.path ?? null,
          overwrite: file?.overwrite ?? null,
        });
      }
    }
  }
  return index;
}

/**
 * Classify one file row found on a mirror page.
 *
 * Verdicts:
 * - `OUT_OF_SCOPE`: the page is not imported; native seeding rules apply.
 * - `ALREADY_TOMBSTONED`: the row is already deleted; nothing to do.
 * - `IMPORTED`: a source row; owned by the import inventory, not repair.
 * - `FIXTURE`: a seeder-planted local row; the repair candidate.
 * - `MIRROR_IMPORT`: genuine bulk-import inventory; never tombstone.
 * - `UNCLASSIFIED_LOCAL`: local-origin but neither seed nor import;
 *   needs human review and never enters the repair manifest.
 */
export function classifyMirrorFileRow(row, seedIndex) {
  if (!row?.page_from_wikidot) {
    return {verdict: "OUT_OF_SCOPE", reason: "page is not imported"};
  }
  if (row.file_deleted_at) {
    return {verdict: "ALREADY_TOMBSTONED", reason: "row already has deleted_at"};
  }
  if (row.file_from_wikidot) {
    return {verdict: "IMPORTED", reason: "imported source row"};
  }
  const seed = (seedIndex ?? new Map()).get(
    seedKey(row.site_slug, row.page_slug, row.name),
  );
  if (seed) {
    return {
      verdict: "FIXTURE",
      reason: `seeder plants '${row.name}' from '${seed.path ?? "unknown"}'`,
      seed_path: seed.path,
      seed_overwrite: seed.overwrite,
    };
  }
  if (MIRROR_IMPORT_COMMENT_PATTERN.test(row.comments ?? "")) {
    return {
      verdict: "MIRROR_IMPORT",
      reason: "bulk mirror-import provenance comment",
    };
  }
  return {
    verdict: "UNCLASSIFIED_LOCAL",
    reason: "local-origin row matching neither seed nor import provenance",
  };
}

/**
 * Build the DRY-RUN tombstone manifest from classified rows. Only
 * `FIXTURE` rows enter; every other verdict is excluded by construction.
 *
 * Repair path note: `ImportService::delete_file` refuses local-origin
 * rows by design, so fixture rows leave through the ordinary file-delete
 * path (`DeleteFile { site_id, page_id, file name, last_revision_id, ... }`)
 * run by an authorized actor. Each entry carries the exact parameters.
 */
export function buildFixtureTombstoneManifest(classifiedRows) {
  const entries = [];
  for (const {row, classification} of classifiedRows ?? []) {
    if (classification?.verdict !== "FIXTURE") continue;
    entries.push({
      site_id: row.site_id,
      site_slug: row.site_slug,
      page_id: row.page_id,
      page_slug: row.page_slug,
      file_id: row.file_id,
      name: row.name,
      last_revision_id: row.last_revision_id,
      size: row.size,
      seed_path: classification.seed_path ?? null,
      suggested_revision_comments: `tombstone fixture file '${row.name}' leaked onto imported page '${row.page_slug}' (Refs #2095)`,
    });
  }
  entries.sort(
    (left, right) =>
      left.site_id - right.site_id ||
      left.page_id - right.page_id ||
      (left.name < right.name ? -1 : left.name > right.name ? 1 : 0),
  );
  return {
    schema: "wikijump.mirror_fixture_file_manifest.v1",
    dry_run: true,
    repair_path: "ordinary file_delete (DeleteFile), NOT import_wikidot_file_delete",
    import_delete_refusal:
      "ImportService::delete_file bails on local-origin rows, so the import delete endpoint cannot remove fixture rows.",
    entry_count: entries.length,
    entries,
  };
}
