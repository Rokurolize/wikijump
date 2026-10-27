# ListPages rating of -6 on a page with no votes (scp-l999)

Read-only investigation. No behavior was changed.

## Question

Where does the score shown by the ListPages module come from, and how can it be
-6 for a page that has no votes? The page is `scp-l999` on site 6000006
(scp-wiki, Standing mirror), page_id 3000021819.

## Where the ListPages score comes from

ListPages has no stored rating column. When a query selects, orders by, or
filters on score, `page_query/service/projection.rs` calls
`ScoreService::scores_bulk` (`deepwell/src/services/score/service.rs`).
A page with no score row falls back to `0.0`. `format_list_pages_rating`
(`render/service.rs`) prints the value for `%%rating%%` and `%%score%%`.

For categories scored by summing, `scores_bulk` computes:

```
score = wikidot_page_snapshot.imported_rating
      + SUM(page_vote.value)   -- rating_system = 'points'
                               -- deleted_at IS NULL, disabled_at IS NULL
                               -- from_wikidot = false when a snapshot exists
```

- `imported_rating` is a `NOT NULL BIGINT`. It is written at import from the
  source page's rating (`apply-corpus-import-manifest.mjs`, `row.rating`).
- When a snapshot exists, only local (`from_wikidot = false`) votes are added to
  it, so imported roster rows are not counted twice.
- A page with no snapshot gets only the vote sum, which is 0 with no rows.
- Star-rated categories use a different path and score as a mean.

The imported aggregate and the imported voter roster (`add_page_votes`) are
separate import steps. A page can have a baseline and no `page_vote` rows.

## Evidence for scp-l999

Observed by the coordinator on the Standing database. This investigation had no
database access and did not reproduce these values.

| Field | Value |
| --- | --- |
| `imported_rating` | -6 (non-null) |
| `page_vote` rows, `rating_system = 'points'` | 0 |
| vote sum | 0 |
| `imported_at` | 2026-07-07 23:19 UTC |
| `source_updated_at` | 2026-07-03 17:23 UTC |

Supporting context from the coordinator's follow-up analysis:

- The snapshot was captured 4 days after the page's last edit, when the page
  was freshly published and had few votes.
- Every other score in the same ListPages box is also lower in Standing than
  live, which is the signature of one older snapshot.
- There are no local non-Wikidot votes to add.

## Conclusion

The score is `-6 + 0 = -6`. The -6 is the imported baseline in
`wikidot_page_snapshot`, and no votes are needed to produce it. The snapshot is
stale: it is a point-in-time capture from 2026-07-07, and the page has
accumulated votes on Wikidot since.

This is **not a code defect** and **not a wrong-source read**. The score formula
behaves as designed and reads the intended column.

## Remediation

- Re-import the page snapshot (and the roster if per-voter data is wanted) to
  refresh `imported_rating`.
- Or accept the value as point-in-time. The Standing mirror reflects its
  last import and is not live.

If a roster is re-imported, `add_page_votes` rejects it when the roster total
differs from the stored `imported_rating`. Refresh the aggregate first.
