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

## Clone feasibility

This format is not yet a thin layer for site cloning. Export is read-only and identity-preserving: it records source page IDs, file IDs, blob hashes, and revision IDs, and it deliberately omits file bytes, revision history, forum state, memberships, roles, page parents/categories, and relationships. A clone needs the opposite direction: create a new site with new identities, then replay content and configuration into those identities under one transaction.

A minimal clone still requires a replay service that creates the destination site and bootstrap content, remaps every page slug and file name to fresh rows, uploads blobs or reuses them with new ownership, creates new page and file revisions with the clone actor as author, rebuilds categories, parents, and forum threads, applies site settings through `site_update`-equivalent validation, and creates only the cloner as master administrator. The current export provides a manifest and page sources that such a replay service can consume, but the replay, identity remap, upload path, and failure-atomic orchestration do not exist. Implementing clone therefore remains separate work rather than a thin wrapper over `site_backup_export`.
