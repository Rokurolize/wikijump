# Flopstyle Dark rev401 transitive dependency audit — 2026-10-05

Audit start: 2026-10-05 18:02 JST. Repository was treated read-only; no Theme Lab package/current-acceptance/migration files were edited. No browser matrix was run.

## Executive conclusion

The rev397 -> rev401 page-source change is real and rendering-affecting. The only raw Wikidot source change is inside the second `[[code type="CSS"]]` block:

```css
.top-bar::before {
-    top: -.5em;
+    top: -.4em;
}
```

That block is not dead documentation. The default theme source later imports `https://scp-wiki.wdfiles.com/local--code/theme%3Aflopstyle-dark/2` from an active `[[module CSS]]`, and the interwiki-style include also points at the same local-code/2 URL. The maintenance planner reports `upstream_inline_css_rule_change_count: 0` because its page-inline comparison extracts active `[[module CSS]]` bodies and does not treat `[[code]]` bodies themselves as inline CSS. The changed code block becomes published CSS through the transitive `local--code/.../2` dependency, which is exactly why the transitive refresh is required.

Across the retained 11-import dependency set, only two current byte identities changed:

1. EN `component:fade-in` local-code/1: substantial semantic change, from `5a2c26fc...` to `ad55661d...`.
2. Flopstyle Dark local-code/2: one semantic declaration change, `.top-bar::before { top: -.5em -> -.4em; }`, from `c6d34160...` to `e8d487a0...`.

The other nine dependency responses are byte-identical to the retained provenance. There are no import-chain changes and no font/asset URL changes in any of the 11 responses.

The current component-refresh candidate CSS `624b3c400c08ad074b830e290efa5f80f6a74f819f4958291e0cf31f0e7d6784` already contains the current Fade In behavior through the reviewed SCP-JP component publication binding; its Fade In CSS differs from current EN only in the source-URL comment. However, it still contains `.top-bar::before { top: -.5em; }`. Therefore the overall candidate classification is:

`current candidate is missing upstream dependency changes`

The missing behavior is exactly the Flopstyle Dark local-code/2 `.top-bar::before` `top` value. A candidate rebuild/rebase is required. A diagnostic copy with only that single declaration changed hashes to `cfb5865dd28e562413dc1cbed44ace29ff4d08eb4bdc8daafcfc87b4e98c8161`, proving that the current `624b...` CSS identity cannot survive the rebase unchanged. This diagnostic hash is not a substitute for the canonical rebuild output.

Because the existing real-Wikidot adaptation evidence is explicitly bound to CSS SHA `624b3c400c...`, **authority recertification required** after the rev401 rebuild. The Flopstyle Sigma-9/Sigma-10 acceptance currently being run by Codex is likewise evidence for the pre-rebase candidate and cannot certify the post-rebase CSS. Re-run Flopstyle Dark's affected/current Sigma-9 and Sigma-10 acceptance after the rebase. Basalt/Foxtrot do not need a rerun solely because of this Flopstyle-only declaration change.

## Why the requested planner count is 11 but the current working-tree planner says 9

The retained baseline at `HEAD:install/local/theme-lab/ports/flopstyle-dark/assets.json` has 11 imports. Codex's in-flight component refresh has already changed the working-tree `assets.json` so EN BetterFootnotes and EN Fade In are no longer imported as candidate asset dependencies; their reviewed SCP-JP publication CSS is materialized locally instead. Consequently, a fresh read-only `theme-port-maintenance.mjs plan` against the current dirty working tree reports 9, not 11.

For this audit the requested 11-dependency inventory is the retained pre-component-refresh import-provenance set from `HEAD`, while current behavior is checked against the refreshed corpus/current public bytes. The upstream EN source graph still includes `component:betterfootnotes` and `component:fade-in`, so both remain relevant to upstream semantic review even though the current JP candidate no longer fetches those EN imports.

## 11 dependency inventory and semantic result

| # | Dependency / source owner | Retained identity | Current identity | Revision / timestamp evidence | Semantic CSS change |
|---:|---|---|---|---|---|
| 1 | `https://fonts.bunny.net/css2?family=Comic+Neue&display=swap` | SHA `969131113dbed9e6b06675ee289e7f51e44df81816d51f6b46871090c3f2ffe5`, 492 B | same SHA, 492 B | provider endpoint; current read 2026-10-05 09:06:18 UTC | none; byte-identical |
| 2 | `https://fonts.bunny.net/css2?family=Montserrat:wght@800&display=swap` | SHA `94d644cf707265fb6aaa71c53b3b5c91fc7b4f6c298dc5120b178d0f188565d7`, 2452 B | same SHA, 2452 B | provider endpoint; current read 2026-10-05 09:06:18 UTC | none; byte-identical |
| 3 | `https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700` | SHA `c2714a976d659d0376202cd04513db747bf1e4977379b3300958c51c69398130`, 404 B | same SHA, 404 B | provider endpoint; current read 2026-10-05 09:06:18 UTC | none; byte-identical |
| 4 | EN `component:croqstyle`, local-code/1 | SHA `f9a4fa40a5771a81b8b88435837fa5c3d4e72193b734ec62331a269adac0a91e`, 10822 B | same SHA, 10822 B | current page rev 44, `2026-06-12T10:31:56Z`; current page-source SHA `3a5b9040...` | none; published CSS byte-identical. The page-source serialization drift does not affect this CSS response |
| 5 | EN `component:fade-in`, local-code/1 | SHA `5a2c26fc39de9766125a3d0a01efdbdec4c65d1b691485af9440fab1374803bc`, 2347 B | SHA `ad55661da67167266e24386f8cb7fbdf54b2edf4168054778a3bed2eef8aebab`, 523 B | current page rev 15, `2026-09-30T22:44:39Z`; current page-source SHA `34e961f1...` | **yes, material**; details below |
| 6 | EN `component:betterfootnotes`, local-code/1 | SHA `4aedde777d67d2a23dd069bcaee758cda60e82b59a8b74c8097a5c3c8e4c1cb5`, 2771 B | same SHA, 2771 B | current page rev 55, `2024-10-27T12:28:26Z`; current page-source SHA `066c8183...` | none; byte-identical |
| 7 | EN `theme:flopstyle-dark`, local-code/1 | SHA `8cf06073da2e0980bf4226b1d5e6916133b63d2a6ce243a76d39df1e6d3f7f6c`, 687 B | same SHA, 687 B | retained page rev397 -> current rev401, `2026-09-28T23:41:46Z` | none; byte-identical |
| 8 | EN `theme:flopstyle-dark`, local-code/2 | SHA `c6d34160c1a607c5b96b7a574854dfde35467e2b5a26fd9a7588b5a419c22592`, 68501 B | SHA `e8d487a0bea8978efb7a53e3fc1b866eb6e1bea7b56e577be5183a0c37b2b93a`, 68501 B | retained page rev397 -> current rev401, `2026-09-28T23:41:46Z` | **yes**; only `.top-bar::before top: -.5em -> -.4em` |
| 9 | EN `theme:flopstyle-dark`, local-code/3 | SHA `d5b4c4dbe64e06c60590785c7797d1dd8ccca1b822b4c7dce8f048af1d1997e8`, 117 B | same SHA, 117 B | retained page rev397 -> current rev401 | none; byte-identical |
| 10 | Flopstyle `tabview.css` attachment | SHA `ffbd600548cdc73701d60c84766746224b3abacafd2397a2830242b3451876a0`, 471 B | same SHA, 471 B | attachment has no separate revision identity in package/corpus metadata; current read 2026-10-05 09:06:22 UTC | none; byte-identical |
| 11 | Flopstyle `backend.css` attachment | SHA `88e08cff5396971983867d39a616dbf09ce80e48d9c675efe7e4d531d0fcc1f0`, 6836 B (normalized text SHA `67c17a11...`) | same raw SHA, 6836 B | attachment has no separate revision identity in package/corpus metadata; current read 2026-10-05 09:06:23 UTC | none; byte-identical |

Current Flopstyle page source identity: rev401, source SHA `bce06e2f87c6962d176e9f54f8bac47815860044b52a16562a139e98a0051b85`. Retained Theme Lab page source: rev397, source SHA `31af257ac4fde398b560f6106ee4f1e916291c40141938a9fcc5b6ef95335c46`.

## Per-dependency semantic classification

Dependencies 1, 2, 3, 4, 6, 7, 9, 10 and 11 are byte-identical retained vs current. Therefore for each of those nine:

- selector added/removed: none
- property/value change: none
- media query change: none
- custom property change: none
- font/asset URL change: none
- import chain change: none
- whitespace-only/comment-only: no; there is no raw-byte difference

### Dependency 5: EN Fade In local-code/1

This is a substantive component behavior update, not a formatting change.

Selector/rule changes:

- Removed `:root:has(#page-tags a[href*=hub])` and `:root:has(#toc)` disabling Fade In on hubs / TOC pages.
- In the unchanged `@media (prefers-reduced-motion: no-preference)` query, replaced `:where(#page-title, #breadcrumbs, #page-content > *)` with `:where(#page-title, #breadcrumbs, #page-content)`.
- Removed `:where(#page-title) { animation-delay: 0s; }`.
- Removed the per-child delay ladder `:where(#page-content > :nth-child(1))` through `:nth-child(15)` plus `:nth-child(n+15)`.

Declaration/value changes:

- Removed custom property `--fade-in-delay: 0s`.
- Removed the conditional `--fade-in: none !important` declarations associated with hub/TOC suppression.
- `animation-duration: 0.6s -> 0.5s`.
- `@keyframes fadeIn` start transform `translate(0,30px) -> translate(0,15px)`.

Media query condition itself: unchanged. Import chain: unchanged. Font/asset URLs: unchanged. A source-URL comment is added, but the change is not comment-only.

The component-refresh candidate already carries this current behavior from SCP-JP. `source-includes/fade-in-input.css` differs from the current EN local-code/1 bytes only by the first comment changing `https://scp-wiki.wikidot.com/component:fade-in` to `https://scp-jp.wikidot.com/component:fade-in`; all functional CSS is the same.

### Dependency 8: Flopstyle Dark local-code/2

Exactly one semantic rule changes:

```text
selector: .top-bar::before
property: top
retained: -.5em
current:  -.4em
```

No selector addition/removal, media-query change, custom-property change, import-chain change, or font/asset URL change was found. This is the only rev397 -> rev401 theme-page source delta and it is active published CSS.

## rev397 -> rev401 page-source interpretation

A raw unified diff of retained `upstream-en.wikidot.txt` against current corpus source has one hunk and one changed declaration only. There are no changes to includes, documentation prose, comments, active `[[module CSS]]` import directives, or other code blocks.

The changed declaration sits inside the second `[[code type="CSS"]]` block (the block begins around source line 1853 and closes around 4935). The default theme source later contains an active `[[module CSS]]` importing local-code/1, local-code/2 and local-code/3. Therefore:

- it is not dead/unselected code;
- it is not merely documentation/example CSS;
- it is not canonicalization-equivalent;
- it is served as `local--code/theme:flopstyle-dark/2` and changes computed positioning of the `.top-bar::before` pseudo-element by `0.1em`.

The planner's zero inline-rule result is correct for its narrower `[[module CSS]]` extraction model, but must not be interpreted as zero rendered behavior change. The rendered delta lives in the transitive local-code response.

## Current candidate coverage

Current working candidate CSS SHA: `624b3c400c08ad074b830e290efa5f80f6a74f819f4958291e0cf31f0e7d6784`.

Observed coverage:

- Fade In: covered. Candidate has `animation-duration: 0.5s`, `translate(0,15px)`, whole-`#page-content` animation, and no old per-child delay ladder. This is semantically current EN rev15 behavior, supplied through the reviewed JP component source.
- Flopstyle local-code/2: **not covered**. Candidate line 1247 still has `.top-bar::before { top: -.5em; }`.
- Other nine dependencies: no upstream byte/semantic change to carry.

Required product change after Codex finishes its current 3-theme acceptance:

1. refresh/rebind the Flopstyle upstream source from rev397 to rev401;
2. refresh/rebind transitive import provenance, retaining the review result that nine are identical, Fade In is already functionally covered by the JP component publication binding, and local-code/2 changed;
3. rebuild the candidate so `.top-bar::before` uses `top: -.4em`;
4. regenerate hashes/maintenance artifacts normally through the repository workflow, not by editing generated CSS directly.

Candidate rebuild required: **yes**.

## Adaptation authority and acceptance impact

The current authority ledger and the three current real-Wikidot receipts bind effective CSS SHA `624b3c400c...`. Because the rev401 rebase changes final candidate CSS identity, **authority recertification required**.

At minimum the currently certified Flopstyle evidence to recapture/rebind is:

- `install/local/theme-lab/ports/authority-evidence/flopstyle-dark-component-refresh-navigation-chromium-20261005/receipt.json`
- `install/local/theme-lab/ports/authority-evidence/flopstyle-dark-component-refresh-navigation-firefox-20261005/receipt.json`
- `install/local/theme-lab/ports/authority-evidence/flopstyle-dark-component-refresh-sigma10-credit-20261005/receipt.json`

The first two are especially directly adjacent to the changed top-bar/navigation styling; the Sigma-10 Credit receipt is also exact-CSS-identity-bound and cannot simply remain certified against a different candidate hash.

Sigma-9/Sigma-10 matrix after rebase: **rerun required for Flopstyle Dark**. The currently running pre-rebase Flopstyle rows remain useful historical/control evidence, but they do not close the post-rebase candidate. No reason was found in this audit to rerun Basalt or Foxtrot solely due to this Flopstyle rev401 change.

## Exact evidence paths

Repository / retained evidence:

- `AGENTS.md`
- `docs/agents/theme-lab.md`
- `docs/agents/compatibility/evidence.md`
- `install/local/theme-lab/ports/UPSTREAM-MAINTENANCE.md`
- `install/local/theme-lab/ports/SOURCE-FRESHNESS-AUDIT-20261005.md`
- `install/local/theme-lab/ports/flopstyle-dark/upstream-en.wikidot.txt`
- `HEAD:install/local/theme-lab/ports/flopstyle-dark/assets.json` — retained 11-import provenance set
- `install/local/theme-lab/ports/flopstyle-dark/source-css-includes.json`
- `install/local/theme-lab/ports/flopstyle-dark/candidate.css`
- `install/local/theme-lab/ports/flopstyle-dark/receipt.json`
- `install/local/theme-lab/ports/adaptation-authority.json`

Current corpus:

- `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/README.md`
- `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/en/pages/theme:flopstyle-dark/source.wikidot.txt`
- `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/en/pages/theme:flopstyle-dark/meta.json`
- `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/en/pages/component:croqstyle/{source.wikidot.txt,meta.json}`
- `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/en/pages/component:fade-in/{source.wikidot.txt,meta.json}`
- `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/en/pages/component:betterfootnotes/{source.wikidot.txt,meta.json}`

Audit-only `/tmp` evidence:

- `/tmp/theme-lab-flopstyle-rev401-audit-retained-assets.json`
- `/tmp/theme-lab-flopstyle-rev401-audit-current/fetch.tsv`
- `/tmp/theme-lab-flopstyle-rev401-audit-current/01.css` ... `/tmp/theme-lab-flopstyle-rev401-audit-current/11.css`
- `/tmp/theme-lab-flopstyle-rev401-dependency-semantic-diff.json`
- `/tmp/flopstyle-candidate-rev401-hypothetical.css`

## Final disposition

- 11 dependency inventory: complete.
- Rendering-affecting upstream dependency changes: EN Fade In current behavior + Flopstyle local-code/2 top-bar offset.
- Current component-refresh candidate coverage: Fade In covered; Flopstyle local-code/2 offset missing.
- Candidate rebuild required: **yes**.
- Real-Wikidot adaptation recertification required: **yes**.
- Flopstyle Sigma-9/Sigma-10 acceptance rerun after rebase: **yes**.
