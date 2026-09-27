# 計算量・I/O増幅レビュー（2026-09-27 第2分）

基準: `6112a90d88`（develop、前回の `cache-complexity-review-20260927.md` と同じ系列）。
本変更は **Framerail の XML-RPC 値パーサ** と **Deepwell の ListPages 閲覧権限判定**の
増幅を削減し、検証 inventory と Theme Lab の二次走査も改善する。リポジトリ全体に二次処理がなくなったという主張ではない。
未着手の項目と残件は末尾に列挙する。

## 入力次元

本レビューでは「n」を一つに畳まない。各経路ごとに以下を定義する。

- `C`: XML-RPC リクエストのバイト数。`H`: 値の入れ子深度（`XML_RPC_MAX_VALUE_DEPTH`=64 で頭打ち）。
- `R`: ListPages のレンダースキャンが走査する行数（`MAX_LISTPAGES_RENDER_SCAN_ROWS`=50,000 が上限）。
- `K`: 任意のdistinct `(site_id, page_category_id)` 数。`A`: 閲覧者が page attribution を持つ行数。
- 前回の系列から継続: `T` theme数、`W` browser×viewport×interaction、`D` DOM node数、
  `S` selector数、`E` dependency edge数、`P` pixel数、`Q` request/job数。

キーの hash はキー長に比例する。Map lookup の expected O(1) 表記は固定長キーを仮定する。

---

## 1. XML-RPC 値パーサ — 改善済み

対象: `framerail/src/lib/server/xmlrpc/protocol.ts`

```text
current:
CPU O(H·C)
  1つの値ごとに候補タグ名を最大9個順番に probe する。
  各 probe は値の部分木全体を走査し、さらに isSelfClosingElement と
  extractOptionalElement が new RegExp を実行ごとに 2〜3 回コンパイルする。
  再帰は item.content という部分文字列を下へ渡すため、
  親は子の全記述域を再走査する。合計 O(H·C)。
  Worst case は 8·H·C 回の regex 走査。
memory O(C)（中間部分文字列の合計は O(H·C)）

target:
CPU O(H·C)（probe は 1 回、match したタグ名の extract のみ。入れ子の再走査は残る）
memory O(C)（値の中間文字列の合計は従来どおり O(H·C)）
  入れ子による中間部分文字列の複製は残存するため O(H·C) の slice は残る

reason:
  値はちょうど1個の要素でなければならないため、その根タグ名だけで
  パーサが決まる。9個の候補 probe は不要。
  部分木一致の判定（extractFirstDirectElement）は変えないので、
  「タグ名が一致しても値が全体，占めなければ unsupported」という
  従来の結果は同一に保たれる。

data structure / algorithm change:
  単一の anchored regex `^<([A-Za-z][\w.:-]*)` で根タグ名を一度だけ読み、
  `XML_RPC_VALUE_TYPE_NAMES` の Set で型を確定して分岐する。
  タグ別の正規表現は `OPEN_TAG_PATTERN_CACHE` / `TAG_PATTERN_CACHE` にコンパイル済みとして
  保持する。呼出側のタグ名はリテラルか固定の型集合に限られるので、
  キャッシュは構築上 request 入力で伸長しない。
  `int`/`i4` の別名と `nil` の自己終了要素は分岐内で同じ扱いを保持する。
```

`permission_in_set_helper` と同様に、判定分岐は単一の
`evaluate_in_permission_set` に集約している（XML-RPC 側は switch のみ）。

## 2. ListPages 閲覧権限 — 改善済み

対象: `deepwell/src/services/render/runtime_page_queries.rs`
（`view_decisions_for_scanned_pages`）、`permission/service.rs`
（`batch_check_page_view_without_page_roles`）、
`relation/page_attribution.rs`（`filter_attributed_page_ids`）

```text
current:
CPU/DB round trips  Θ(R) 回・1行あたり 5〜9（本番 DB 実測）
  行ごとに `check_user_can(page_reference=Some)` を呼ぶ。
  1 回の内部で -ban probe / 明示ロール join / virtual ロール scan /
  membership probe / page 取得 / attribution 取得 / category scope probe-
  が走る。`page_reference` が Some のとき Redis 権限 cache は短絡で無効化される
  ので、cache がこの経路を節約していない。
  50,000 行の scan は最悪 250,000〜450,000 の逐次 round trip になりうる。
  なお `filter_viewable_rows` の引数 `category_permissions` は
  名前付きの `_category_permissions` として受け取って捨てられていた。

target:
DB round trips  O(1 + K + A)
  attribution を1回、site ごとに権限導出を1回、
  distinct `(site, category)` ごとに scope probe を1回。
  残るのは閲覧者が page attribution を持つ A 行の個別判定だけであり、
  A ≤ R であり、全行がその閲覧者の著作なら worst case は依然 O(R)。
CPU は BTreeSet/BTreeMap の membership/grouping により
O(R log(R+1) + R log(K+1))、権限導出後の permission HashSet 参照は
expected O(R)。DB 往復の削減が主効果であり、CPU を厳密な線形とは呼ばない。

reason:
  権限判定の入力のうち `page_reference` が影響するのは
  `is_page_author` だけである。ban probe・明示ロール・virtual ロール・
  membership はいずれも `(user_id, site_id)` のみに依存することを
  `role/service.rs:761-777, 788-796, 805-819` で確認した。
  `PageAuthor` は生きた page attribution を要求するので、
  「閲覧者が attribution を持たないページ」の page reference は
  何も追加できない。よってその集合はまとめて導出を共有できる。
  既存コードの「同 category で他ページに判断を再利用してはいけない」
  というコメントはそのまま妥当であり、attribution を持たないという
  十分条件のほうで満たしている。

data structure / algorithm change:
  1) `filter_attributed_page_ids`: `page_id IN (...)` の一括 relation query。
     行ごとの `PageService::get` + `get_page_attributions` を置換。
  2) `batch_check_page_view_without_page_roles`: viewer/site ごとに
     `get_permissions_for_user(..., None)` を1回、category ごとに
     `check_category_scoped` を1回（呼び出し側が保持する
     `BTreeMap<(i64, Option<i64>), bool>` に記録）。
  3) `view_decisions_for_scanned_pages`: attribution を持つ行だけ
     従来の `check_user_can` に渡し、残りを site ごとに batch する。
     順序と site 混在を保つため結果は元の index に書き戻す。
  4) 判定分岐は `evaluate_in_permission_set` に一本化し、単発・バッチの
     両方がそれを呼ぶ。不一致が構造的に起きないようにした。
```

権限 cache について: page-scoped 判定は従来どおり cache を読まない。
`permission_in_set_helper` の `cacheable` は
`is_cacheable(..) && !page_scoped_roles && !ban_suppresses` で短絡するため、
page 参照ありのときは Redis に読み書きしない。batch 経路も同じ短絡を
持たせており、page-scoped 判定が後から読み戻す cache entry を
batch が書き込むことはない。

## 実測

### 2. ListPages 閲覧権限（`deepwell/tests/listpages_permission_scaling.rs`）

実 DB 上、4 distinct category、viewer は全行閲覧可。R を 10→160（16倍）へ。
各 round は独立した短い transaction（長い transaction を共有 DB で開くと
HOT chain の問題が出るため）。pool と plan は warm 済み。

| R | reference(ms) | batched(ms) | speedup |
|---:|---:|---:|---:|
| 10 | 14.38 | 2.39 | 6.0x |
| 20 | 25.58 | 2.57 | 10.0x |
| 40 | 49.81 | 2.60 | 19.2x |
| 80 | 103.48 | 3.01 | 34.4x |
| 160 | 200.61 | 2.80 | 71.5x |

- reference は R の 16 倍で 13.9 倍（1行 ≈ 1.25ms）。行数に比例。
- batched は 1.17 倍。平坦であり、R に依存しない。
- speedup が R に比例して増える（6.0x → 71.5x）ことが
  Θ(R)→O(1+K+A) の観測可能な signature である。

`view_permission_scaling_is_flat_in_row_count` が
「batched の増加率 < 6.0」を assert する（実測 1.17）。
生値は `docs/development/listpages-permission-scaling-results.txt`。

### 1. XML-RPC（`framerail/xmlrpc-scaling-bench.mjs`）

旧 parser は固定 Git revision の SHA-256 固定 fixture から読む。
比較は旧呼出しそのもの。Node v24.21.0、warm-up 後5回の中央値。
`scanChars` は regex 実行前の `lastIndex` から match 終端まで（miss は
残りの入力末尾まで）の**計測上の走査範囲**。regex engine の内部 backtracking
回数そのものではない。`test()` が内部で `exec()` を呼ぶ分は二重計上しない。

| 経路 | bytes | scan before | scan after | 削減 | RegExp 前 | 後 | ms 前 | 後 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| depth H=8 | 814 | 46,773 | 13,923 | 3.36x | 185 | 0 | 0.201 | 0.052 |
| depth H=16 | 1,364 | 141,721 | 39,706 | 3.57x | 337 | 0 | 0.423 | 0.140 |
| depth H=32 | 2,468 | 485,593 | 131,026 | 3.71x | 641 | 0 | 1.039 | 0.457 |
| depth H=56 | 4,124 | 1,386,361 | 367,366 | 3.77x | 1,097 | 0 | 2.375 | 1.251 |
| flat 64 members | 4,093 | 57,572 | 27,782 | 2.07x | 664 | 0 | 0.722 | 0.221 |
| flat 512 members | 32,243 | 462,761 | 223,451 | 2.07x | 5,144 | 0 | 5.524 | 1.412 |
| bytes H=32 | 2,660 | 562,777 | 150,994 | 3.73x | 641 | 0 | 1.342 | 0.820 |
| bytes H=32 | 4,452 | 1,283,161 | 337,362 | 3.80x | 641 | 0 | 1.220 | 0.541 |

測定中に指標を修正した。初版は `exec` に渡した入力長を計上し、その後の版も
`lastIndex` を実行後に読んで hit の範囲を過小計上していた。実行前の offset を
保持し、`test()` の内部 `exec()` も一度だけ計上する形に直した。
**flat 系列は約2.00x bytes に対して約2.00x 仕事**で
真に線形であること、depth 系列だけが約3倍/深化で増えることを確認した
（REST の sibling 走査に二次性は無い）。このため「flat が二次」という
初期の推測は棄却している。

RegExp コンパイルは warm 後に 0。タグ名 cache は request 入力で伸長しない
（`XML_RPC_VALUE_TYPE_NAMES` の固定10種類と、`value`/`member`/`name`/`data`/
`params`/`methodName`/`methodCall`/`param` のリテラルに限られる）。

### 残存する O(H·C)

改善後も depth 系列は O(H·C) である。残る原因は、
`extractOptionalElement` が対応する閉じタグを depth counting で探すため
親が子の全範囲を走査し、再帰で子も自分の範囲を走査すること。
H=56 の計測走査範囲は入力 4,124 bytes の約336倍から約89倍へ下がったが、
依然として入れ子に応じて増える。
これを消すには単一パスの streaming parser（tag stack を持ち、
親が子の extent を求める際に再帰も一緒に処理する）が必要で、
複数 fault を含む document で「どの fault が先に出るか」が変わる可能性がある。
fail-closed の観測可能な挙動が変わるため今回は未着手とし、
残件として明記する。

## 3. Documentation inventory traversal

Input dimensions: `V` documentation pages, `E` extracted references, `M` maximum
pending queue entries, `B` source bytes read, and `J` emitted claims. The queue
comparison uses `localeCompare`; the original initial sort uses code-unit order.

```text
current:
  reason membership: sum over targets of O(in-degree²), worst O(E²)
  queue: O(E·M log M) full-sort work plus O(E·M) Array.shift work;
         M can reach E, yielding O(E² log E) in the worst case

target:
  reason membership: expected O(E)
  queue: O(V log V), with each page queued at most once
  total traversal: O(B + E + V log V), plus unchanged output sorting
                   O(V log V + J log J)

reason:
  New references frequently point to a page already pending. The old queue
  inserted another copy and sorted the whole pending array after every newly
  accepted reason. An already inspected page could also be queued again.

data structure / algorithm change:
  A Map of reason Sets replaces repeated Array.includes checks, while the
  emitted reason arrays retain their original insertion order. A queued Set
  and inspected Set bound pushes to V. A min-heap replaces repeated full sorts
  and shifts. The initial code-unit ordering is retained until the first
  accepted reason, when the old implementation switched to localeCompare.
```

The edge-dominated synthetic corpus keeps 803 inspected pages and increases
forward fan-in; every reference is still parsed and recorded. Node v24, warm-up
plus five timed runs per point, median milliseconds. Fixture creation is outside
the timed region. The old source is loaded from Git revision `6112a90d88`
without modifying the worktree.

| E references | old ms | new ms | speedup |
|---:|---:|---:|---:|
| 9,811 | 2,955.95 | 2,836.85 | 1.04x |
| 17,221 | 3,535.64 | 2,878.27 | 1.23x |
| 30,841 | 6,009.63 | 2,914.26 | 2.06x |

The reference count rises 3.14x while the old wall time rises 2.03x and the
new wall time rises 1.03x. File enumeration and reads hide much of the queue
term at smaller sizes; these wall times alone do not establish a linear total
runtime. Queue work is bounded by V in the new algorithm rather than E. An
independent 120-page, 3,766-reference differential corpus matched the original
inventory exactly after removing only `generated_at`: document order and
reasons, claims, references, missing references, hashes, and summaries all
matched. A focused punctuation-name regression verifies the initial sort and
later comparator transition. All seven inventory tests pass.

Memory adds O(E) reason-index membership beside existing O(E) reason arrays,
while pending queue memory falls from O(E) worst case to O(V). Disk reads,
serialization volume, filesystem syscalls, network requests, browser
navigations, process spawns, and locks are unchanged. The benchmark's baseline
source import invokes Git once outside timing.

## 4. Theme Lab selector and original-URL indices

Let `S_r` be reference rules, `S_q` requested selectors, and `U` distinct
original URLs belonging to one content-addressed object.

```text
current:
  selector lookup O(S_q · S_r) from one Array.find per requested selector
  original URL insertion O(U²) cumulative from Array.includes

target:
  selector lookup expected O(S_r + S_q)
  original URL insertion expected O(U), including one O(U) hydration
  when an existing manifest record is first touched

reason:
  Neither operation needs to revisit all prior entries for each new entry.

data structure / algorithm change:
  A first-match Map is built for the requested selector projection. A WeakMap
  associates each manifest object record with a Set of its original URLs;
  the serialized array remains in first-seen order.
```

The selector test covers duplicate rules, first-match `atContext`, requested
order, and absent-selector fallback. The URL test covers duplicates and a
save/reload cycle. The Theme Lab full test suite passes. The benchmark loads
the original ReferenceCache from the same Git revision and compares exact
emitted arrays. Medians are milliseconds; selector rows repeat each operation
20 times per sample, and URL rows use five fresh cache instances per size.

| Dimension | n | old ms | new ms | old comparisons | new index operations |
|---|---:|---:|---:|---:|---:|
| selectors | 100 | 0.045 | 0.010 | 5,050 | 200 |
| selectors | 200 | 0.047 | 0.017 | 20,100 | 400 |
| selectors | 400 | 0.228 | 0.021 | 80,200 | 800 |
| selectors | 800 | 0.944 | 0.050 | 320,400 | 1,600 |
| original URLs | 200 | 2.677 | 2.426 | 19,900 | 200 |
| original URLs | 400 | 2.470 | 2.080 | 79,800 | 400 |
| original URLs | 800 | 3.887 | 3.147 | 319,600 | 800 |
| original URLs | 1,600 | 7.642 | 4.821 | 1,279,200 | 1,600 |

Selector indexing adds O(S_r) temporary memory. URL indexing adds O(U)
resident memory while the manifest array already takes O(U). The URL benchmark
includes unchanged SHA-256 work per store. Object write count, manifest
serialization, network acquisition, process and browser work, and locks do not
change.

## 5. Persistent browser response cache acquisition lock

Let `Q` be concurrent distinct external misses, `L` the latency of one external
acquisition, `N` the number of retained manifest entries, and `B` their total
serialized body bytes.

```text
current:
  acquisition lock occupancy O(Q·L + Q·(N+B)) for Q distinct misses
  effective external acquisition concurrency 1

target reached in this batch:
  per-identity lock occupancy O(L) for each identity;
  global manifest lock excludes network acquisition
  external acquisition concurrency may reach Q

reason:
  The cache previously held the one manifest lock while awaiting the fetch.
  Unrelated identities therefore waited through each other's network latency.

data structure / algorithm change:
  A SHA-256-named lock per normalized request key coalesces the same identity
  across cache instances and processes. Short global manifest-lock sections
  recheck persisted entries, seal the acquisition barrier, and finalize the
  result. The producer runs outside that global lock. A persisted barrier takes
  precedence over a concurrently visible unsealed entry, so an overlapping
  manifest write cannot make uncertain evidence replayable.
```

A benchmark runs the real old and new cache implementations with a 75 ms
simulated external acquisition per distinct identity. Each cache instance
performs durable barrier and response writes. Three fresh-cache samples per
point; medians in milliseconds.

| Q | old ms | new ms | old peak acquisitions | new peak acquisitions |
|---:|---:|---:|---:|---:|
| 1 | 89.06 | 105.18 | 1 | 1 |
| 2 | 181.54 | 123.72 | 1 | 2 |
| 4 | 360.66 | 160.01 | 1 | 4 |
| 8 | 724.38 | 269.76 | 1 | 5 |

The Q=8 new path is 2.69x faster and permits five simultaneous acquisition
callbacks in this run. The remaining global manifest work limits peak
concurrency. The 87-test browser request gate suite covers same-identity
coalescing, cross-process fills, durable barriers, crash refusal, distinct
concurrency, and unsealed-entry replay refusal.

**Unresolved manifest amplification:** every barrier/finalization still reads,
decodes, serializes, and rewrites the complete manifest. Across Q new entries,
this remains O(Q·(N+B)) bytes and globally serialized disk work; with N and B
growing with Q, cumulative I/O remains quadratic. The lock split removes
network latency from the global critical section but does not eliminate the
whole-file I/O term. A durable per-entry journal or immutable entry shards,
with migration of existing manifest v1 data and crash-safe compaction, remains
required before this finding can be closed. No external acquisition was used
for this benchmark.

## 6. Deepwell per-row query batching (continuation)

The remaining Deepwell findings were re-verified against this checkout. Each
was confirmed to issue one or more queries per row/page/template before being
changed. The invariant shared by the permission changes below: a page reference
can only add the `PageAuthor` virtual role, and that role requires a live page
attribution, so pages the viewer has not authored can share one derivation and
one category probe per distinct category. Anonymous viewers can never hold an
attribution, so their batches are unconditional.

### 6.1 `ViewService::backlinks` (`services/view/backlinks.rs`)

```text
current:
  DB rows read  O(N² / B)   (OFFSET pagination re-reads from row 0 each page)
  point queries O(N)        (PageService::get_optional per connection)
  permission    O(N) page-scoped derivations (cache-disabled for a page ref)

target:
  DB rows read  O(N)        (keyset on the (to_page_id, connection_type,
                             from_page_id) primary key)
  point queries O(N / B)    (one Page::find with PageId IN (...) per page of
                             connections, site-scoped and non-deleted)
  permission    O(1 + K + A) via view_decisions_for_scanned_pages

reason:
  `from_page_id` is unique for a fixed (target, Link) pair, so `> last` visits
  each connection exactly once. The candidate source pages are resolvable in
  bulk without changing `get_optional`'s site/deleted semantics.

data structure / algorithm change:
  `OFFSET offset` is replaced by a `last_from_page_id` cursor. Connections are
  batched into one `Page::find(... PageId.is_in(...))`; the existing
  attribution-safe `view_decisions_for_scanned_pages` resolves visibility.
```

### 6.2 TagCloud (`services/render/runtime_modules/tag_cloud.rs`)

```text
current:
  permission    one page-scoped check per site page P
  revision tags single `IN (...)` with one bind parameter per visible revision;
                a site larger than PostgreSQL's 65,535 bind-parameter ceiling
                fails the entire render

target:
  permission    O(1 + K)  (anonymous, so one batched derivation + one category
                probe per distinct category)
  revision tags ceil(P / 10,000) chunked queries

reason:
  The TagCloud viewer is anonymous, so a page reference contributes no virtual
  role and the batched path is exactly equivalent. Chunking only changes how
  the identical `IN` predicate is issued.

data structure / algorithm change:
  The per-page loop is replaced by `batch_check_page_view_without_page_roles`;
  the revision-tag fetch is split into `REVISION_ID_QUERY_CHUNK = 10_000` chunks
  whose counts are accumulated into the same `BTreeMap`.
```

### 6.3 `ViewService::get_page_templates` (`services/view/service.rs`)

```text
current:
  permission    one page-scoped derivation per template
  revision/text 2 queries per template (get_latest + TextService::get)

target:
  permission    O(1 + K + A)
  revision/text 1 joined query for the whole template list

data structure / algorithm change:
  `view_decisions_for_scanned_pages` resolves visibility; a new
  `PageRevisionService::get_latest_title_and_wikitext_batch` fetches
  (page_id, title, contents) in one left-joined query. A template whose latest
  revision/text is missing still errors, matching `get_latest` + `TextService::get`.
```

### 6.4 Wikidot DataForm pagepaths (`services/data_form/runtime.rs`)

```text
current:
  permission    one page-scoped check per page in the field's category
  parents       one ParentService::get_parents query per visible page (O(P))

target:
  permission    O(1 + K + A)
  parents       1 query per field (ParentService::get_parents_batch)

data structure / algorithm change:
  Permissions use `view_decisions_for_scanned_pages`. A new
  `ParentService::get_parents_batch` groups `page_parent` rows by
  `child_page_id` in one `IN (...)`; the `[relationship] => parent` shape is
  preserved.
```

### 6.5 `MembershipService::pending_applications` (`services/membership/service.rs`)

```text
current:  one UserService::get per pending application (O(A))
target:   one UserService::get_public_identities(ctx, user_ids) (2 queries total)

data structure / algorithm change:
  Pending `(from_id, comment)` pairs are collected first, then resolved from one
  `get_public_identities` map. Order and the "user unavailable" error for a
  missing identity are preserved.
```

### 6.6 Residual within this group

`render/list_pages/bounded_expansion.rs::resolve_named_pages` was the target of
the review's `resolve_exact_name_pages` item; that symbol does not exist in this
checkout and the entry was stale. The real function is bounded by
`MAX_LIST_PAGES_MODULES = 256`, and its per-page `ScoreService::score` already
has a batched sibling (`scores_bulk`) that itself still calls `get_scorer` per
page, so the residual constant factor is small and was deliberately left
unchanged rather than optimized for appearance.

## 7. Backlinks module per-render reuse (`services/render/backlinks.rs`)

```text
current:
  query        one load per `[[module Backlinks]]` occurrence
  permission   one anonymous page-scoped check per result row

target:
  query        one load per render (the module resolves for the page being
               rendered, which is fixed for the call)
  permission   O(1 + K) via the anonymous batched path

reason:
  Occurrences on one page produce identical output; the viewer is anonymous, so
  batching is exactly equivalent. `compat_html.push_block_html` is still called
  once per occurrence, preserving fragment registration.

data structure / algorithm change:
  `expand_backlinks_modules` memoizes the loaded rows in an
  `Option<Option<Vec<...>>>`; `load_backlinks_module_pages` uses
  `batch_check_page_view_without_page_roles`.
```

## 8. Verification tooling repeated I/O

### 8.1 Evidence reads (`scripts/lib/wikidot-live-evidence.mjs`, `scripts/generate-wikidot-specifications.mjs`)

Measured on the current tree: the external-evidence verifier performed 455
reads over 117 distinct files (3.9x), and the detailed-contract alias check
performed 125 reads over 23 distinct files (5.4x). An earlier "125 -> 11 files"
figure in the residual list was not reproducible from this checkout and is
withdrawn. Each reference now reuses a run-scoped `Map<absolutePath, Buffer>`
while still re-verifying its own expected SHA-256, so the drift test in
`tests/wikidot-live-evidence-format.test.mjs` (which passes no cache) still
fails closed. Output is unchanged (`node scripts/generate-wikidot-specifications.mjs
--check` still validates 210 specifications and 1806 corpus pages).

### 8.2 `render-health.mjs` parse-once

`classifyRenderedPage` computed `stripNonContent(html)` and then
`findRawSyntaxLeaks` recomputed the same fixed-point strip. `findRawSyntaxLeaks`
now accepts the already-computed `content`, halving the strip work per page with
identical findings (the exported signature stays backward compatible).

The remaining parse-once candidates (`syntax-differential.mjs`,
`listpages-preview-classification.mjs`, `corpus-snapshot.mjs`) are measured
constant-factor redundancies (2-3x), not super-linear amplification, and are
retained; `corpus-snapshot.mjs` already caches the expensive hashing.

## 9. Theme Lab viewport-overflow ancestor rescan (`src/browser-lab.mjs`)

```text
current:  O(D · H) — for every one of D DOM elements the code walks up to H
          ancestors, calling getComputedStyle and getBoundingClientRect on each
target:   O(D)

reason:
  The clipping test is existential over strict ancestors: an element is clipped
  when some ancestor has a clipping `overflow-x`, a right edge within the
  viewport, and the element's right edge exceeds that ancestor's by more than
  2px. Testing each ancestor individually is equivalent to comparing the
  element's right edge against the minimum qualifying ancestor right edge.

data structure / algorithm change:
  One document-order pass (`querySelectorAll("body *")` is pre-order, so a
  parent always precedes its children) inherits `min(ancestor bound,
  parent's own qualifying right edge)` into a `Map`, then evaluates the same
  filter/sort/slice(0,5) chain. Rounded rect and top-5 tie order are preserved.
```

## CPU以外の評価

| 次元 | XML-RPC | ListPages 閲覧権限 |
|---|---|---|
| memory | cache は固定10+8エントリ。値の中間文字列は従来どおり | attribution 一括結果は O(A)。判定配列 O(R) |
| disk I/O | 変更なし（0→0） | 変更なし。行データは従来どおり取得される |
| serialization/deserialization | 出力形式・順序は不変。decode 回数は不変 | 変更なし |
| filesystem syscall | 0→0 | 0→0 |
| network request | 0→0（route 数は不変、body 上限 64MiB も不変） | 0→0。HTTP 層は不変 |
| browser navigation | 0 | 0 |
| process spawn | 0 | 0 |
| lock / serial section | 新規なし。Node event loop 内の走査を削減 | Redis 権限 cache の lock 方針は不変。**DB round trip を通常行について行数依存から category 依存へ削減** |
| duplicated parse/compile | **RegExp コンパイルを全廃** | 権限導出の重複を全廃 |

## 正しさと受入

### XML-RPC

- 差分テスト `framerail/tests/xmlrpc-parser-dispatch-equivalence.test.js`:
  変更前 Git blob の SHA-256 固定 fixture を読み込み、**103 document 以上**について
  戻り値と `faultCode`/`faultString` が完全一致することを assert する。
  対象は scalar 全種、array/struct、self-closing、属性付き、CRLF、whitespace 過剰、
  `i4` 別名、duplicate member、nested `<value>`、不正 int/boolean/double、
  未閉じタグ、depth/width を 1〜80 まで生成した形、params 欠落、comment 拒否、BOM。
- 未知タグ名 500 種で RegExp コンパイルが 8 回以下であることを assert（cache が
  入力で伸長しないこと）。warm 後にコンパイルが再発しないことも assert。
- **Framerail unit: 596/596 (.test.js) + 58/58 (.test.ts) = 654 PASS。**
- production build は未実行（本変更は parser 内部のみで型は不変）。

### ListPages 閲覧権限

- `deepwell/tests/listpages_permission_batch.rs`（4 test、**全て PASS**）:
  - 4 種の viewer（anonymous / view 可 / member で view 不可 / role 無し）について
    **旧 page-scoped 実装（reference）を新実装と行ごとに比較**。
    9 page × 3 category。
  - warm な category cache を共有しても decision が変わらないこと。
  - **権限漏えいの回帰**: attribution を持つ page は作者に閲覧可能だが、
    同一 category の兄弟 page と他のすべての page は閲覧不能であること。
  - category-scoped な `page:view` が自 category だけに効くこと。
- **mutation test**: `batch_check_page_view_without_page_roles` に
  page-scoped 仮想 role を意図的に混入させると
  「PageAuthor must not grant view of another page in the same category」で
  テストが落ちることを確認した。テストが実際に漏えいを検出できる証拠。
  最初は page id 1（fixture site に存在しない）を使って mutation が効かなかった。
  実 page id を取得する形に fixtures を作り直している。
- `deepwell/tests/listpages_permission_scaling.rs`（1 test、PASS）:
  R=10..160 で新旧一致を各サイズで assert に加えて平坦性を assert。
- **Deepwell lib unit: 1566 passed / 0 failed。**
- **既存 integration（permission, role, site_ban, list_pages, page の 154 test）:
  回帰ゼロ。** 変更前後で失敗集合が完全一致（13 件）。この 13 件は
  開発 DB の seed 済み fixture による `duplicate key page_pkey` で、
  **変更前の revision でも同一に失敗する**ため環境由来。
  `page` の 1 件は baseline 側が flaky で、変更後は 3 回連続で pass。

### Deepwell 継続分（6〜7節）

- `deepwell` は `cargo check --offline --locked --lib` / `--tests` と
  `cargo test --no-run` を pass。
- Deepwell integration 全体（sharded、tmpfs MinIO 修正下）を最終ソースで
  再実行し pass。`listpages_permission_batch` / `listpages_permission_scaling`
  を含む全 shard:
  `{"schema":"wikijump_deepwell_sharded_validation.v1","shards":8,
  "elapsed_ms":203571,"partitioned_tests_run":2188,"failed":false}`。
  （途中 2 回は性能修正ではなく、検証実行中にソースを編集したことによる
  build race で fail しており、ソース凍結後に pass した。）
- 2026-09-27 07:29 の先行 tmpfs 実行（`failed:false`, 2188 tests）も
  tmpfs MinIO 修正の証拠として保持する。
- 6 節・7 節の権限変更は `check_user_can` と同値の batched path を用いるため、
  新たに allow になる case は無い。PageAuthor の attribution 安全性は
  ListPages と同じ `view_decisions_for_scanned_pages`（attribution 除外の
  十分条件）を共有する。

### 検証ツールと Theme Lab（8〜9節）

- hermetic verification suite（`install/local/wikidot-verification`）:
  **2044/2044 pass**（8 節の変更を含む）。
- `node scripts/generate-wikidot-specifications.mjs --check`: pass
  （210 specifications / 1806 corpus pages）。
- `wikidot-live-evidence-format` / `listpages-campaign-inventory` /
  `wikidot-specification-source-boundaries`: 13/13 pass。
- `render-health`: 22/22 pass。
- Theme Lab: 160/160 pass。
- repository generated-contract verification: pass（surface_count 954）。

### develop 統合後（post-integration, 2026-09-27）

feature branch を `origin/develop`（`ad6a27f630`、base `6112a90d88` から
9 commit 先）へ通常 merge commit で統合した。競合は
`run-deepwell-integration-validation.mjs` の tmpfs 行のみで、develop の
`size=2g` と本 branch の説明コメントを両方残して解決した（tmpfs 修正自体は
両側に存在し、重複していた）。統合後の検証:

- Deepwell integration: 8/8 shards pass、**2189 tests**、`failed:false`
  （develop の追加テストにより 2188 から +1）。
- hermetic verification suite: **2045/2045 pass**（develop の追加テストで +1）。
- Framerail unit: **655/655 pass**（XML-RPC 差分テストを含む）。
- Framerail `pnpm check`: 0 errors。
- Theme Lab: 160/160 pass。
- repository generated-contract verification: pass。
- `cargo fmt --all -- --check` / `git diff --check`: clean。

sharded runner の初回統合実行は、8 並列ビルド下で sccache が
`Compile terminated by signal 15` を受けて 6 shard がビルド失敗した
（コード起因ではない）。テストバイナリを単一プロセスで
`cargo test --no-run` により事前ビルドしてから再実行し、8/8 pass を確認した。

### 性能測定について

6〜9 節の新規修正はクエリ数／I/O 回数の削減として構成上明確であり、
実 DB の独立した scaling series は取得していない（Deepwell sharded
integration は正しさの回帰確認であって性能測定ではない）。2・3 節の
実測は変更していない。

## Trade-offs

- **XML-RPC**: `int` と `i4` のような別名を持つため分岐が tag 名ごとに増える。
  分岐は tag 名ごとに増えるだけで、関数引数は増えない。tag pattern cache は module 寿命で生存するので、
  長寿命プロセスでも 18 エントリ上限で一定。
- **ListPages**: `Attribution` 一括照会の結果は最大 O(A)。
  A はその viewer の page attribution を持つ走査行数で、0 ≤ A ≤ R。
  A=R の worst case では個別権限判定が残る。通常行の attribution 判定は
  行ごとの照会から一括照会へ変わる。
  category memo は呼び出し側が持ち、render 単位で共有される。
- いずれも permission の「deny を fail-closed に保つ」性質は変えていない。
  新たに allow になる case は無い（旧実装と同じ入力に対して同じ答えを出す）。

## 未着手の項目と残件

本レビューは**全リポジトリの監査でも、是正完了でも無い**。今回の継続分で
6〜9 節の項目を是正し、残りは以下のとおり。

### 今回是正した項目

- Deepwell の逐次/per-row クエリ: `ViewService::backlinks` の OFFSET、
  TagCloud の per-page 権限と O(P) bind placeholder、`get_page_templates` の
  per-template query、DataForm pagepaths の per-page 権限/parents、
  `pending_applications` の per-application user 取得（6 節）。
- `render/backlinks.rs` の per-occurrence 再読込と per-row 権限（7 節）。
- 検証 evidence の反復 read/hash（run-scoped cache）と
  `render-health.mjs` の二重 strip（8 節）。
- Theme Lab `collectViewportOverflow` の O(D·H) ancestor 再走査（9 節）。

### 未解決（意図的に保持）

1. **Theme Lab audit の whole-file rewrite** — `capture-interactive.mjs` が
   theme ごとに audit 全体を read/parse/merge/serialize/write する。T は theme
   数（約 35）で上限がありユーザー入力次元に比例しないため bounded。
   除去には delta shard + crash-safe snapshot merge が必要で、実行途中の
   durability と supersede 順序を変えるため今回は未着手。
2. **`browser-request-gate.mjs` の manifest I/O** — 5 節末尾と同じ。
   append-only / per-entry shard 化が必要。
3. **`forum_mini` の per-render cache 欠落** — 同一 page 上の重複
   `[[module Forum]]` 呼び出しが同じ CTE と可視性導出を繰り返す。
   `MAX_FORUM_MINI_MODULES_PER_RENDER = 32` で bounded。引数 `(kind, limit)` に
   よる memo 化が可能だが未着手。
4. **parse-once 候補（`syntax-differential.mjs`,
   `listpages-preview-classification.mjs`, `corpus-snapshot.mjs`）** —
   実測で 2〜3 倍の constant-factor 重複で、超線形ではない。
   `render-health.mjs` は今回是正。`corpus-snapshot.mjs` は既に hash を cache
   済みで、freeze CLI がディレクトリを二度 walk するだけ。
5. **`resolve_named_pages`** — 旧レビューの `resolve_exact_name_pages` は
   この checkout に存在しない名前で、実体は `bounded_expansion.rs` の
   `resolve_named_pages`。`MAX_LIST_PAGES_MODULES = 256` で bounded。
   `scores_bulk` は既存だが内部で `get_scorer` を page ごとに呼ぶため、
   単純置換の利得は小さく今回は変更しない。
6. **XML-RPC の残存 O(H·C)** — 1 節末尾に記載。単一パス streaming parser が
   必要で、複数 fault の順序という観測可能な挙動を変えうるため未着手。
7. **`getPagesMeta` の逐次 Deepwell round trip**（`resource-methods.ts`）—
   上限 10 件なので計算量ではなく latency。`Promise.all` を page 単位で
   持ち上げるだけ。

調査で除外: ListPages child-content は現行の
`render/list_pages/rendering/block_render.rs` で既に
`get_wikitext_optional_batch` を site ごとに呼んでいる。旧監査の逐次取得指摘は
この checkout に適用しない。

FTML、Wikidot 構文/DOM/CSS、oracle/provenance は変更していない。検証 inventory の走査実装は変更し、出力同等性を差分テストで確認した。
ブラウザ表示変更・standing promotion は本変更の証明に用いていない。
