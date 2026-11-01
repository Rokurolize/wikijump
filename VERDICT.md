# Verdict: one slug, snapshots from several source branches (theme:fogwalker)

Lane pstack-fogwalker, 2026-11-01 JST. Branch `pstack/fogwalker-prototype`, based on
origin/develop 03f09279b9. This is a prototype. Nothing here has been applied to
Standing or stafflab. The only Standing access was read-only SELECTs and one
anonymous GET of `/amoris`.

## Goal

On the scp-wiki mirror, amoris includes `:scp-int:theme:fogwalker`, and that
payload includes `:scpko:theme:fogwalker`. The mirror cannot hold both
snapshots, because each is stored as a page whose slug is its source fullname,
and `page_current_site_slug_unique` allows one `theme:fogwalker` per site. The
question is which storage model lets one fullname hold snapshots from several
source sites without changing the #2690 rule that foreign snapshots 404 when
visited directly.

## Recommendation

Adopt with changes. Model (b), provenance-namespaced storage slugs, works on the
real chain. It needs a one-line resolver change, and the import applier must
stop treating the page slug as the snapshot's identity. It needs no schema
change and no rerender of existing pages. The changes required before it can
ship are listed under "What a production version must add".

## What the hole costs today

Measured on Standing, 2026-11-01 16:35 JST, with an anonymous GET of
`https://scp-wiki.wikijump.localhost/amoris`:

- The page contains `Included page "theme:fogwalker" does not exist`.
- The page contains zero occurrences of the scpko theme's fonts (`GowunBatang`,
  `Griun_PolSensibility`).

The scpko payload is mostly two `[[module CSS]]` blocks (lines 84 to 508 of
`corpus/ko/pages/theme:fogwalker/source.wikidot.txt`). They sit outside its
`[[iftags +테마]]` block and inside a `display:none` div, and a CSS module
inside a hidden div still emits its style. The scp-int payload carries only a
short override and says "To read full CSS code, see the original theme page".
I infer that on Wikidot amoris gets the full fogwalker theme through the nested
include, so on Standing the missing include costs reader-visible styling, not
only a hidden error string. This is inferred from the sources and has not been
checked against a live Wikidot capture, because the corpus `html.xmlrpc.html`
holds only the body.

The hole is also wider than one page. The scpko payload's own closure collides
four more times with pages scp-wiki owns: `info:start` and `info:end` (via
`:scpko:info:start`), `component:image-block` (an unprefixed include inside the
scpko source, which #3044213a2a resolves against scpko first), and
`component:image-block-base`. The demo below lands none of the five scpko rows
under today's model.

## Candidates

The include resolver already keys imported cross-site sources on (holding
site, `source_site`, `source_fullname`). `fetch_imported_cross_site_source`
(`deepwell/src/services/render/runtime.rs`) joins `wikidot_page_snapshot` on
those columns and never filters on `page.slug`. The block comes entirely from
where the snapshot's page row is stored.

- (a) Provenance-qualified snapshot keys. The lookup half already exists. The
  storage half would mean allowing two pages with one slug on a site, which
  relaxes `page_current_site_slug_unique` (migration 20260824010000). Every
  slug-based page lookup in Deepwell assumes one row per (site, slug).
  Dropped on cost.
- (b) Distinct internal slug per provenance. Store each foreign snapshot's page
  at `_foreign:<source_site>:<source_fullname>`. No redirect is needed, because
  resolution already goes through the snapshot row. Chosen.
- (c) Rewrite nested includes in the payload at import. The rewritten bytes no
  longer match `source_sha256`, and `verify-corpus-import-integrity.mjs:109`
  checks stored text against that hash, so (c) requires weakening an integrity
  check. The rewrite would also have to parse includes inside `@@...@@`
  literals and `{$var}` arguments, as the int payload has. The pages still need
  a storage slug, so (c) needs (b) anyway. Dropped.

## The demonstration

`deepwell/tests/fogwalker_prototype.rs` runs against a task-owned Postgres,
Valkey, and MinIO stack (`withTaskOwnedDeepwellStack`), removed after each run.
It seeds the real closure into the seeded `scp-wiki` site, so `:scp-wiki:`
includes are same-site, as on Standing. Fixture bytes are the shared-corpus
sources in `deepwell/tests/fixtures/fogwalker-chain/`: en amoris, info:start,
info:end, component:earthworm, and component:croqstyle; int theme:fogwalker;
and ko theme:fogwalker, info:start, info:end, component:image-block, and
component:image-block-base. Amoris carries its Standing tags.

The test seeds everything twice, each pass in its own rolled-back transaction.
The first pass uses today's natural-slug storage and the second uses
namespaced storage. Foreign rows land the way the applier's DB mode lands them:
a page row at the storage slug plus a snapshot row. scp-int lands first, as on
Standing. Each pass renders amoris and a set of probe pages through `page_get`.

Result of the passing run, 2026-11-01 16:42 JST, at commit 54a1c4e75b:

| Check | Natural (today) | Namespaced |
| --- | --- | --- |
| Foreign rows that cannot be stored | 5 scpko rows | 0 |
| Include errors in amoris | 1 (`theme:fogwalker`) | 0 |
| scpko theme CSS (`GowunBatang`) in amoris styles | absent | present |
| `[[include :scpko:info:start]]` | include error | scpko's page (`정보`), not scp-wiki's (`Info`) |

Direct visits. For every foreign row, under both layouts, `page_get` by page
id and by storage slug returns the missing-page result. Page lookup matches
the exact stored slug first (`deepwell/src/utils/slug.rs`), so a request for
`/_foreign:scpko:theme:fogwalker` does find the storage row. The #2690
foreign-snapshot exclusion is what turns it into a 404, the same rule that
hides natural-slug foreign rows today. `page_get` by
the source fullname never returns the foreign row. Where scp-wiki owns that
name, as with `info:start`, it returns scp-wiki's own page. That matches what
Wikidot shows on the scp-wiki host. So the #2690 behavior is unchanged.

Regression probes. Six probe pages rendered under both layouts, and the test
compares their compiled HTML and styles byte for byte:

1. Same-site own include (`[[include info:start]]`).
2. A same-site own component whose name an scpko row also holds
   (`component:image-block`).
3. A cross-site include to another local site (`:test:...`).
4. A cross-site include of a pre-migration foreign row still at its natural
   slug. This proves a mixed store works, so migration can be partial.
5. A cross-site include with no snapshot anywhere. This keeps the standard
   error.
6. A cross-site include of an imported source with a relative attachment.

All six were identical once the resolver change was in. Probe 6 is the reason
for that change. Without it, run 2 (16:34 JST) rendered
`local--files/_foreign:scpko:component:fogwalker-proto-attach/proto-relative.png`
under namespaced storage against
`local--files/component:fogwalker-proto-attach/proto-relative.png` under
natural storage. The storage slug leaked into the DOM.

## The resolver change

`fetch_imported_cross_site_source` now reports the source fullname as
`IncludeSource.page_slug`, which is the attachment owner for the source's
relative files, instead of the holding page's slug. The per-render cache
stores only the wikitext. For every existing row this changes nothing. On
Standing, `page.slug = source_fullname` for every one of the 25,012 snapshot
rows (`slug_differs = 0`, read-only query, 16:20 JST). Probe 4 confirms the
output is identical for a natural-slug row.

Existing suites run on this branch: see "Regression suites" below.

## What a production version must add

1. Applier storage rule. `apply-corpus-import-manifest.mjs` uses `row.fullname`
   as the page slug at about a dozen sites: the shell insert (line 643), the
   batched insert and its joins (lines 1110 to 1238), `target_page`
   (line 635), `existingActivePage`, and the RPC `getPage` and attachment paths
   (lines 1279 to 1313). It needs one `storageSlug(row)` function, with foreign
   rows mapped to `_foreign:<source_site>:<fullname>`. Foreign means the same
   thing as in `foreign_snapshot_exclusion_sql`. Existing pages must be found
   through the snapshot's (source_site, source_entity_id), not the slug.
   `--create-mode rpc` normalizes slugs, so foreign rows must use DB mode.
2. Close the provenance-overwrite hazard. Today, `--adopt-existing` or
   `--replace-existing` would adopt the scp-int page for an scpko row
   (`target_page` matches on slug), and the snapshot upsert's
   `ON CONFLICT (page_id) DO UPDATE SET source_site = EXCLUDED.source_site`
   would silently swap its provenance. That would break amoris's outer include.
   Rule 1 removes the slug match that causes this.
3. Category. A storage slug splits at its last colon, so
   `_foreign:scpko:theme:fogwalker` would land in a new category
   `_foreign:scpko:theme`. `CategoryService::get_all_active` and the admin view
   would list it, and the resolver's View check reads `page.page_category_id`.
   Storage pages must stay in their source fullname's category (`theme` here).
   The prototype left them in `_default`, which its probes don't observe.
4. Reserve the prefix. Wikidot fullnames can have several colons (Standing has
   17, all own en pages such as `art:re:goi-arts`), and Wikidot keeps a leading
   underscore in a category. The applier should reject an own row whose
   fullname starts with `_foreign:`. Standing has none today.
5. Integrity verifier. `verify-corpus-import-integrity.mjs:141` joins
   `page.slug = requested.slug`. It must join through the snapshot for foreign
   rows. `refresh-mirror-from-corpus.mjs` matches local pages to corpus slugs
   by `page.slug` and would read namespaced rows as unknown extras. It needs
   the same change.

## Migration cost for existing snapshots

Standing holds 25,012 snapshot rows. Under the #2690 rule, 64 are foreign, all
on scp-wiki. No other site holds a foreign row. The other 24,948 are own rows
and do not move.

- Phase 0: ship the resolver change. It is a no-op for all 25,012 rows (above).
- Phase 1: the applier writes new foreign rows namespaced. Then land the five
  scpko rows and rerender amoris. Nothing existing moves, and the mixed store
  is proven by probe 4.
- Phase 2, optional: rename the 62 file-less foreign rows with one `UPDATE page
  SET slug` (category unchanged, per rule 3). No rerender is needed, because
  compiled output of includers depends on source wikitext and on the fullname
  the resolver now reports, and neither changes. This phase only frees the
  natural names for future own pages. Today a foreign row at `theme:fogwalker`
  would block a later live scp-wiki page of that name.
- Leave the two file-bearing rows, `d3-readonly-assets` `test544` (75 files)
  and `odule:crab` (4 files), at their natural slugs. Absolute
  `https://d3-readonly-assets.wdfiles.com/local--files/test544/...` URLs are
  localized to the holding site's files host with the same path, and file
  serving looks the page up by that path segment. Moving these rows needs file
  localization to key on provenance first. That is separate work and not needed
  for fogwalker.

## Known limits this does not fix

- `wikidot_page_snapshot` has a global `UNIQUE(source_site, source_fullname)`,
  not one per holding site. If scp-jp ever needs `:scpko:theme:fogwalker` while
  scp-wiki holds it, the second import fails. No site but scp-wiki holds foreign
  rows today. The fix is a holding-site column in that key.
- Relative attachments inside a foreign source resolve to
  `<holding site files host>/local--files/<fullname>/...`. On Wikidot they
  would point at the source site. This is unchanged by the prototype.

## Regression suites

Run on this branch with the resolver change, 2026-11-01 16:42 to 16:51 JST, on a
task-owned stack:

- `cargo test --lib services::render`: 1457 passed, 0 failed.
- `cargo test --test page include`: 28 passed, 0 failed.
- `cargo test --test page foreign`: 2 passed, 0 failed. This is the #2690
  suite, including the missing-page and nested-source-site tests.
- `cargo test --test fogwalker_prototype`: 1 passed.

Not run: clippy, the consolidated validation runner, and the generated-contract
checks. This branch is not proposed for merge.

## Why there is no PR

The deepwell part of the prototype is small and passes. But the model is only
safe once the applier follows rules 1 to 5 above, and the prototype modeled the
applier in a test fixture instead of changing it. Merging the resolver change
alone would be harmless, because it is a no-op for every stored row, but it
would not unblock fogwalker. The real build should take the resolver change,
the applier storage rule, the category rule, and the verifier join together,
then run Phase 1 on Standing through the normal promotion path.
