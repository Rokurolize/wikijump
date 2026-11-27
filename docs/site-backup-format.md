# Site backup archive format

`site_backup_export` returns the bytes of one uncompressed POSIX `ustar` TAR archive as a hex string (Deepwell's `Bytes` JSON representation). The caller can decode the hex and save the result with a `.tar` extension. The endpoint requires the site administration permission already used by `site_update` (`Resource::Site` + `Action::Edit`) and a numeric site ID. Deleted sites cannot be exported.

The archive is a point-in-time snapshot: generation only reads site state and does not mutate pages, files, settings, memberships, or revisions. Entries are ordered by numeric page ID and then by path. `manifest.json` is always last. The archive ends with the two zero blocks required by TAR. Every entry uses mode `0644`, uid/gid `0`, and mtime `0`; only the name, size, type flag, and content are significant.

## Entries

- `manifest.json` — UTF-8 JSON object, pretty-printed with two-space indentation.
- `pages/<page_id>.wikitext` — UTF-8 current wikitext source of one active page. The path uses the numeric page ID so slugs with categories or separators cannot create path traversal. `manifest.json` maps each path back to the page slug.

No other entries are present. File contents are not copied into the archive; the manifest records the SHA-256 of the latest blob in the file store so a reader with blob access can retrieve it. This keeps the archive bounded for sites with large attachments.

## Manifest fields

`format` is the literal string `wikijump-site-backup` and `version` is `1`. `exported_at_unix` is the Unix timestamp at generation time. `site_id`, `slug`, `name`, `tagline`, `description`, `locale`, `default_page`, `layout`, `license`, and `settings` are the site's settings snapshot. `settings` is the same `SiteSettings` object used by `site_get`. `aliases` and `domains` are sorted lists of site alias slugs and custom domain names at snapshot time.

`pages` is the complete list of active pages. Each entry has `page_id`, `slug`, `title`, `revision_id`, `wikitext_sha256_hex`, and `path`. `files` is the complete list of active files. Each entry has `file_id`, `page_id`, `page_slug`, `name`, and `latest_revision`. `latest_revision` is `null` only for a file row without revisions; otherwise it contains `revision_id`, `mime`, `size`, and `blob_sha256_hex`.

Generation fails rather than publishing a partial archive when a page has no revision, an entry name exceeds the 100-byte `ustar` name field, or the archive would exceed 64 MiB. There is no content-dependent omission: every active page and file is in the manifest.

## Version 2 (additive export & product-level import)

`site_backup_export` accepts an optional `version` parameter (`1` by default; `2` selects the additive v2 format). `site_backup_import` accepts both v1 and v2 archives and reconciles them into an existing target site under `Resource::Site` + `Action::Edit` authorization.

### Backward compatibility with v1 readers

Every v2 addition is strictly additive:

- `manifest.json` keeps all v1 top-level fields (`format`, `version` = `2`, `exported_at_unix`, `site_id`, `slug`, `name`, `tagline`, `description`, `locale`, `default_page`, `layout`, `license`, `settings`, `aliases`, `domains`, `pages`, `files`).
- Each `pages[]` entry keeps `page_id`, `slug`, `title`, `revision_id`, `wikitext_sha256_hex`, and `path` (`pages/<page_id>.wikitext` for the latest revision), so a v1 reader that ignores unknown JSON fields still reads the latest page sources.
- Each `files[]` entry keeps `file_id`, `page_id`, `page_slug`, `name`, and `latest_revision`. (Note: in v1, `latest_revision.blob_sha256_hex` actually encoded `file_revision.s3_hash` (SHA-512); v2 computes actual SHA-256 hex when blob bytes are available and records the raw `s3_hash` in `blob_sha512_hex`.)

### Additional TAR entries in v2

- `pages/<page_id>/rev-<revision_number>.wikitext` — UTF-8 wikitext for non-head revisions when a page has more than one revision. The head revision continues to live at `pages/<page_id>.wikitext` so its bytes are not duplicated.
- `files/<file_id>.bin` — raw attachment bytes for the latest revision of each active file whose blob exists in the object store.

### Additional manifest fields in v2

- `pages[]` adds:
  - `alt_title: string | null`
  - `tags: string[]`
  - `layout: string | null` (from the page's latest revision or site default)
  - `revisions: BackupPageRevision[]` (ordered ascending by `revision_number`):
    - `revision_id: i64`
    - `revision_number: i32`
    - `revision_type: string`
    - `created_at_unix: i64`
    - `user_id: i64`
    - `author_name: string | null`
    - `comments: string`
    - `title: string`
    - `alt_title: string | null`
    - `tags: string[]`
    - `slug: string`
    - `wikitext_sha256_hex: string`
    - `path: string` (`pages/<page_id>.wikitext` for the head revision, `pages/<page_id>/rev-<revision_number>.wikitext` for earlier revisions)
- `files[].latest_revision` adds:
  - `blob_sha512_hex: string | null` — hex-encoded SHA-512 `s3_hash`.
  - `path: string | null` — archive path under `files/` (e.g. `files/<file_id>.bin`) when blob bytes are embedded.
  - `user_id: i64 | null`
  - `created_at_unix: i64 | null`
  - `comments: string | null`

### Import (`site_backup_import`) and collision policies

`site_backup_import` takes `{ site, archive, page_collision?, file_collision?, domain_collision?, alias_collision?, apply_settings?, ip_address? }`, validates the TAR checksums, entry names, and `manifest.json` hashes, and executes inside the request transaction. When a revision's original `user_id` exists in `known_user`, authorship is preserved; otherwise the importing actor is used and a provenance note is recorded in revision comments.

Collision policies default to `skip`:

1. **Page slug (`page_collision`)**:
   - `skip` (default): leave the existing target page untouched and map its `page_id` as the target for any incoming files on that slug.
   - `overwrite`: append a new revision to the existing target page (`PageService::edit` with `system_writer: true`).
   - `rename`: create a new page at `<slug>-imported` (or `<slug>-imported-<N>`) and map incoming files for that source page to the renamed page.
   - `error`: abort with `ErrorType::PageExists`.
2. **File name (`file_collision`)**:
   - `skip` (default): leave the existing file on the target page untouched.
   - `overwrite`: upload a new file revision (`FileService::edit` with `direct_upload`) on the existing file.
   - `rename`: create a new file on the target page with `<stem>-imported.<ext>` (or `<stem>-imported-<N>.<ext>`).
   - `error`: abort with `ErrorType::FileExists`.
3. **Custom domain (`domain_collision`)**:
   - `skip` (default): skip domains already registered on the platform (or invalid/reserved), recording a warning when owned by another site.
   - `error`: abort with `ErrorType::CustomDomainExists` if owned by another site.
4. **Site alias (`alias_collision`)**:
   - `skip` (default): skip aliases already registered on the platform (or reserved), recording a warning when owned by another site.
   - `error`: abort with `ErrorType::AliasExists` (or `BadRequest` if reserved) if owned by another site.

## Clone feasibility

This format is not yet a thin layer for site cloning. Export is read-only and identity-preserving: it records source page IDs, file IDs, blob hashes, and revision IDs, and it deliberately omits file bytes, revision history, forum state, memberships, roles, page parents/categories, and relationships. A clone needs the opposite direction: create a new site with new identities, then replay content and configuration into those identities under one transaction.

A minimal clone still requires a replay service that creates the destination site and bootstrap content, remaps every page slug and file name to fresh rows, uploads blobs or reuses them with new ownership, creates new page and file revisions with the clone actor as author, rebuilds categories, parents, and forum threads, applies site settings through `site_update`-equivalent validation, and creates only the cloner as master administrator. The current export provides a manifest and page sources that such a replay service can consume, but the replay, identity remap, upload path, and failure-atomic orchestration do not exist. Implementing clone therefore remains separate work rather than a thin wrapper over `site_backup_export`.
