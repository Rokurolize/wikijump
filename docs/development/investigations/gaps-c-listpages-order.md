# ListPages ordering: scp-9506 "More From This Author" and general ordering risks

Read-only investigation. No behavior was changed. The Wikijump side was read
from source; nothing here was compared against live Wikidot by this
investigation. The only live observation is the scp-9506 box orders supplied by
the requester (section 1).

## 1. Verdict for the scp-9506 "More From This Author" box

**Verdict: not a defect. Compare this box as an unordered set.**

- Box: the "More From This Author" SCPs row on scp-9506, produced by
  `component:wikimodule`.
- ListPages call: `category='*'`, `created_by='='`, `tags='scp'`, `perPage=15`,
  `limit=15`, `order='random'`, `range='others'`.
- Live order: SCP-9870, SCP-9890, SCP-9008, SCP-9728, SCP-9606, SCP-8584,
  SCP-9501, SCP-L999.
- Standing order: SCP-L999, SCP-9890, SCP-9501, SCP-9728, SCP-9870, SCP-9008,
  SCP-8584, SCP-9606.
- Both sides return the same set of 8 pages, and the two orders differ.

Basis: the source specifies `order='random'`, so any order of the same set is
valid. The difference is unspecified by design. This was settled in the local
follow-up, and this report records that outcome without independently
re-deriving it.

Code check consistent with that verdict: `random` parses to
`OrderProperty::Random` (`query_helpers.rs`, `parse_list_pages_order`) and
orders with SQL `random()` in `apply_sql_ordering`
(`deepwell/src/services/page_query/service/ordering.rs`). There is no stable
order to match.

Action for fidelity diffs: compare the set of pages in this box, not their
sequence. Do not file or reopen an ordering issue for the box's sequence.

Scope limit: the verdict covers only this box's sequence. It says nothing about
the other items below, which stay open.

## 2. How Wikijump orders ListPages items (summary)

- Parsing: `deepwell/src/services/render/list_pages/substitution/query_helpers.rs`
  (`parse_list_pages_order`). The default is `CreatedAt` descending. A bare
  field is ascending, a `-` prefix is descending, and `Asc`/`Desc`/
  `Ascending`/`Descending` suffixes and a space-separated `asc`/`desc` work.
  `field desc desc` parses as ascending. Unknown fields or token shapes fall
  back to the default.
- SQL ordering: `deepwell/src/services/page_query/service/ordering.rs`
  (`apply_sql_ordering`). Ties generally break on the Wikidot page id taken
  from the imported snapshot (falling back to local `page_id`), then
  `page_id`.
- Deferred Rust ordering: `deepwell/src/services/page_query/service/projection.rs`.
  `rating`/`score` and `_data_form_field` sort in Rust. Score ties break on
  title ascending regardless of score direction; a code comment attributes this
  to live Wikidot.
- Default order, direction-suffix parsing, the score tie-break, and data-form
  field ordering are backed by repository evidence or code comments. See
  `dataforms-listpages-selection-sorting-live` in
  `docs/wikidot-specifications/specifications/data-forms/data-forms-selecting-and-sorting.md`.

## 3. Open risks (separate from the scp-9506 box)

None of these are explained by, or resolved by, the verdict in section 1. They
remain open and unverified against live Wikidot.

1. **`name`/`slug` and `title`/`alt_title` normalization.**
   - `name` sorts on the slug with the category prefix removed and
     non-alphanumerics stripped.
   - `title` sorts on the lowercased title with characters other than
     alphanumerics and whitespace removed.
   - No retained live artifact for these normalizations was found in this
     investigation, so whether they match Wikidot is unconfirmed.
2. **Possible non-ASCII collation mismatch between the SQL sort and the Rust
   tie-break.**
   - The SQL sort uses Postgres `lower()`, `[[:alnum:]]`, and the database
     collation, which are locale-dependent.
   - The Rust score tie-break (`compare_ordering_titles`) uses ASCII-only
     lowercasing.
   - For non-ASCII titles, for example Japanese titles on scp-jp, the two
     paths can disagree with each other and may disagree with Wikidot.
3. **`created_by` sorts by numeric user id, not user name.** The SQL orders by
   the first revision's `user_id`. Wikidot ordering by user name would differ.
   Unverified against live Wikidot.
4. **Unchecked `reverse` pagination TODO.** `service.rs` carries a
   `TODO pagination` comment about per-page reversal with `reverse = true`.
   Whether the implemented behavior matches Wikidot was not checked.

Secondary unverified items: the `field desc desc` ascending quirk and the full
title tie-break chain have no evidence artifact that this investigation could
locate.

## 4. Suggested follow-up (not performed)

Capture or locate live Wikidot observations for each of items 1 to 4 under the
rules in `docs/agents/compatibility/evidence.md`, then add regression tests
for any confirmed difference. This investigation did neither.
