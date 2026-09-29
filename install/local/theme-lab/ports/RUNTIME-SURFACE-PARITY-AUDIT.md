# Wikidot-facing runtime parity audit

Date: 2026-09-29. This report records the current Trust Lab surface inventory and the source evidence available on this branch. The machine-readable authority is [`fixtures/runtime-surface-parity.json`](../fixtures/runtime-surface-parity.json); each row there records evidence, implementation and test references, intentional differences, and open gaps.

## Decision rule

Theme Lab measures candidate CSS against the local Wikijump runtime. That proves local behavior only. A runtime difference may become a port requirement only where the exact surface scope is `PARITY_CERTIFIED`. `PARITY_MISMATCH`, `INSUFFICIENT_EVIDENCE`, `THEME_LAB_ONLY_SYNTHETIC_SURFACE`, and unclassified runtime findings are retained as diagnostics and quarantined from `next_actions`. Dependency and include failures remain actionable because they do not depend on the Wikidot-facing surface contract.

An accepted screenshot or passing test does not certify source parity. The 35-package interactive audit is local SCP-JP candidate evidence and remains intact; its screenshots were not discarded or recaptured for this change.

## Current EN source baseline

- Wikidot supplies its generic Base theme stylesheet. The frozen local artifact used by the hermetic Theme Lab browser integration test is [`framerail/static/wikidot/styles/wikidot-base-165bc434fd1d.css`](../../../../framerail/static/wikidot/styles/wikidot-base-165bc434fd1d.css), SHA-256 `165bc434fd1da2092fee0ea6bdeb55aa38402aaaafd6d1e3303180d2b595b981`. The live site-theme asset observation records the versioned `common--theme/base/css/style.css` asset as the first stylesheet for built-in themes that include Base; the Theme Lab fixture uses the retained general Wikidot CSS, not Sigma-10.
- The current SCP-EN `theme:site` source identifies the page as **Sigma-10 Theme**. Its frozen source hash is `17f5d83fc92f3f171fcdb790f78fe207db86203eeca1e34f508631fb36daca34` (source updated `2026-05-22T09:04:20Z`). It instructs the site owner to import `https://cdn.scpwiki.com/theme/en/sigma/css/sigma.min.css`.
- The dependency graph binds that import and the official [`scpwiki/sigma` repository](https://github.com/scpwiki/sigma). The retained resolved stylesheet [`candidate-base.css`](site/candidate-base.css) has SHA-256 `869c96d0a83b3beef1775abe5c08801a319443a301ea6e8f056b0a38ad9e6833`; this is the Sigma stylesheet input, distinct from Wikidot Base CSS.
- These claims are bound by [`site/manifest.json`](site/manifest.json), [`site/upstream-en.wikidot.txt`](site/upstream-en.wikidot.txt), [`ports/en-theme-dependency-graph.json`](en-theme-dependency-graph.json), and the [current SCP Wiki theme page](https://scp-wiki.wikidot.com/theme:site). The source repository README describes Sigma as the default CSS used by SCP Wiki.

## Live History comparison

Anonymous read-only `wikidot.py` 4.4.1 captures were made on 2026-09-29 for `scp-173` on `scp-wiki.wikidot.com` (page 1956234) and `scp-jp.wikidot.com` (page 19439882). Both `history/PageRevisionListModule` fragments have one `table.page-history`, seven cells in the same order, revision row ids `revision-row-{id}`, `from` and `to` radios, a flags cell, V/S action links, `.printuser.avatarhover`, `.odate`, and comments. The English and Japanese header/flag labels differ while the structure stays the same. The complete response hashes and request receipts are in [`evidence/wikidot-history-parity-20260929.json`](../evidence/wikidot-history-parity-20260929.json) and its adjacent `*.responses/` directory.

The Japanese capture contains an `F` file/attachment deletion row numbered 37 between page rows 38 and 36. Its timestamp sorts between those page events, and it retains the same seven cells, V/S links, author, date, and comment fields. Wikijump now merges page and file revision data for WIKIDOT-facing History, orders the observed event by creation time, and assigns one ordinal across both streams. The native Wikijump History view continues to use page revisions only. The narrow timeline certificate covers this observed deletion shape and placement; it does not establish other file-operation variants, equal-timestamp ordering, or V/S outcomes. AMC fragments do not expose source-side CSS or browser behavior, so History mobile presentation, pagination, focus/hover states, and action outcomes remain unproven. They contain `.odate` markup and date text but do not establish final client-side hydration or visibility. Wikijump's retained Wikidot Base CSS hides `.odate` with `display:none`, so visible and relative-date parity also remains unverified and quarantined.

## Surface inventory

The table lists all 41 unique IDs currently discovered by Theme Lab's CSS analyzer and interactive capture states, plus explicit History subscopes and the unmatched-runtime bucket. Alias ids are kept explicit because Theme Lab uses both naming schemes. The two certified History rows cover only the captured seven-cell table contract and the one observed file-deletion timeline event; neither certifies the whole History surface.

| Surface ID | Status | Port action allowed? |
|---|---|:---:|
| `content.article` | `INSUFFICIENT_EVIDENCE` | no |
| `content.blockquote` | `INSUFFICIENT_EVIDENCE` | no |
| `content.code` | `INSUFFICIENT_EVIDENCE` | no |
| `content.collapsible` | `INSUFFICIENT_EVIDENCE` | no |
| `content.credit` | `INSUFFICIENT_EVIDENCE` | no |
| `content.footnotes` | `INSUFFICIENT_EVIDENCE` | no |
| `content.image-block` | `INSUFFICIENT_EVIDENCE` | no |
| `content.link` | `INSUFFICIENT_EVIDENCE` | no |
| `content.links` | `INSUFFICIENT_EVIDENCE` | no |
| `content.rating` | `INSUFFICIENT_EVIDENCE` | no |
| `content.table` | `INSUFFICIENT_EVIDENCE` | no |
| `content.tabview` | `INSUFFICIENT_EVIDENCE` | no |
| `content.toc` | `INSUFFICIENT_EVIDENCE` | no |
| `credit.close-back` | `INSUFFICIENT_EVIDENCE` | no |
| `credit.default` | `INSUFFICIENT_EVIDENCE` | no |
| `credit.otherwise` | `INSUFFICIENT_EVIDENCE` | no |
| `credit.view` | `INSUFFICIENT_EVIDENCE` | no |
| `dialog.generic` | `INSUFFICIENT_EVIDENCE` | no |
| `nav.desktop-top` | `INSUFFICIENT_EVIDENCE` | no |
| `nav.mobile-top` | `INSUFFICIENT_EVIDENCE` | no |
| `nav.mobile-top.forced-submenu-state` | `THEME_LAB_ONLY_SYNTHETIC_SURFACE` | no |
| `nav.sidebar` | `INSUFFICIENT_EVIDENCE` | no |
| `nav.tablet-top` | `INSUFFICIENT_EVIDENCE` | no |
| `nav.top` | `INSUFFICIENT_EVIDENCE` | no |
| `page.actions` | `INSUFFICIENT_EVIDENCE` | no |
| `page.backlinks` | `INSUFFICIENT_EVIDENCE` | no |
| `page.delete` | `INSUFFICIENT_EVIDENCE` | no |
| `page.diff` | `INSUFFICIENT_EVIDENCE` | no |
| `page.edit` | `INSUFFICIENT_EVIDENCE` | no |
| `page.files` | `INSUFFICIENT_EVIDENCE` | no |
| `page.history` | `INSUFFICIENT_EVIDENCE` | no |
| `page.history.file-revision-timeline` | `PARITY_CERTIFIED` | yes |
| `page.history.table-dom` | `PARITY_CERTIFIED` | yes |
| `page.normal` | `INSUFFICIENT_EVIDENCE` | no |
| `page.options` | `INSUFFICIENT_EVIDENCE` | no |
| `page.parent` | `INSUFFICIENT_EVIDENCE` | no |
| `page.rename` | `INSUFFICIENT_EVIDENCE` | no |
| `page.source` | `INSUFFICIENT_EVIDENCE` | no |
| `page.tags` | `INSUFFICIENT_EVIDENCE` | no |
| `shell.container` | `INSUFFICIENT_EVIDENCE` | no |
| `shell.footer` | `INSUFFICIENT_EVIDENCE` | no |
| `shell.footer-license` | `INSUFFICIENT_EVIDENCE` | no |
| `shell.header` | `INSUFFICIENT_EVIDENCE` | no |
| `shell.interwiki` | `INSUFFICIENT_EVIDENCE` | no |
| `shell.interwiki.fixture` | `THEME_LAB_ONLY_SYNTHETIC_SURFACE` | no |
| `shell.license` | `INSUFFICIENT_EVIDENCE` | no |
| `shell.login` | `INSUFFICIENT_EVIDENCE` | no |
| `shell.search` | `INSUFFICIENT_EVIDENCE` | no |
| `unclassified-runtime-surface` | `INSUFFICIENT_EVIDENCE` | no |

For `page.history.table-dom`, “yes” applies only to discrepancies in the certified seven-cell DOM contract. For `page.history.file-revision-timeline`, “yes” applies only to the observed F deletion row and its event-time position and shared ordinal. Other file operations, action outcomes, presentation, temporal states, mobile behavior, and paging remain in the quarantined whole-surface record.

### Material surface findings

- The CSS surface analyzer originally omitted `page.history` and `page.files`. Both are now discovered. Their quick fixture probes can report that the action-pane fixture is absent; this is evidence of coverage gaps, not a theme instruction to synthesize those structures.
- The interactive harness force-opens one mobile submenu by adding a Theme Lab-only class and stylesheet, and appends an Interwiki iframe fixture. Those rows are `THEME_LAB_ONLY_SYNTHETIC_SURFACE`; they cannot certify real Wikidot states.
- The registry has no source-side parity certificate for the shell, menus, rating, credit, article modules, page actions, Files, dialog, footer/license, or other interactive surfaces. These are individually `INSUFFICIENT_EVIDENCE`; no inference of success is made from the existing local interaction corpus. All 41 active IDs remain quarantined except where a finding is explicitly matched to one of the two narrow History certificates.

## Adaptation audit

| Classification | Finding | Decision |
|---|---|---|
| C — confirmed emulator-only workaround, removed | `HistoryPane.svelte` used six semantic cells, no from/to radios, a desktop grid to imitate imported-theme placements, and a locally invented mobile card layout. The live EN and JP AMC fragments show a seven-cell table, so this was a Wikijump/Wikidot mismatch rather than an EN/JP requirement. | Fixed in Wikijump WIKIDOT History rendering; the six-cell grid/card override was deleted. No Theme Lab candidate CSS was rewritten. |
| C — confirmed runtime mismatch, fixed | WIKIDOT-facing History omitted file revisions from the page timeline even though the retained JP AMC response places a file deletion between page rows 38 and 36 as row 37. | WIKIDOT History now merges the page and file revision streams by event time and assigns a shared ordinal. Native Wikijump History remains page-revision-only. No theme CSS change was needed. |
| B — intentional EN/JP difference, retained | Live History header and flag tooltip strings are localized; the seven cell positions and selectors are shared. | Localize text only. Keep DOM order identical. |
| D — source proof missing, quarantined | SCPedia mobile History overrides mention a “History card grid” and target `.revision-row` sizing; Much Cool reserves phone-width action-pane heading space from a WebKit Source screenshot. Available artifacts are local candidate captures and do not pair these behaviors with the corresponding live Wikidot source state. The capture harness also had stale metadata claiming mobile History reflows to cards. | Leave candidate rules and accepted screenshots unchanged. The metadata now records that the AMC fragment does not establish mobile scroll/reflow behavior. These rules cannot be promoted as port requirements while the whole History surface remains uncertified. |
| D — source proof missing, quarantined | SCP-JP header/search, credit-return, label-contrast, and long-name wrapping rules exist in port or generated-adaptation inputs. Some comments explain the Japanese text or local contrast problem, but the current source oracle does not provide matching Wikidot interaction/browser states for those claims. | Treat them as port hypotheses, not proven A/B requirements, until paired source evidence shows which differences are actual JP localization requirements. No candidate source was rewritten. |

The search covered all Theme Lab candidate CSS and Wikitext source inputs, maintenance base/final/override files, the generated interactive-adaptation source, surface spec, interactive capture code, and retained asset CSS. Rules that simply implement the imported theme itself were not mislabeled as emulator repairs. This continuation removed no candidate CSS: inspected `.page-history` rules, including SCPedia and Monotypical styles, are not proven emulator-only workarounds by the retained source evidence. The D cases stay actionable for source capture but are quarantined from port conclusions.

## Source-side oracle gaps

The `theme:site` reference capture and dependency graph bind a normal rendered source page and its resources. They do not contain paired source-side captures for the states that the local interactive harness measures. Relevant gaps include mobile submenu open/close, sidebar open/close, hover and keyboard focus, rating states, credit open/close and return, alternate selected tab, expanded collapsible, History and Files panes, page source/version, dialogs, and other action panes. Existing `interaction_diagnostics` in a port receipt report candidate-side checks; they are not proof of the same source-side state.

The current harness also includes explicitly synthetic states. A source-side browser oracle would need state-specific read-only acquisition, response retention, browser executable identity, paired viewport/state/action records, and explicit missing-state outcomes. This audit does not add a generic live-source browser system: the current evidence establishes that the source state matrix is missing, but does not yet choose a safe/general source fixture and action contract for all surfaces. Until that focused capture work exists, the registry gates the relevant findings.

## Regression and preservation

- Frozen-history tests verify raw response digests, the seven-cell contract for both source sites, and the observed F deletion row's identity, order, ordinal, and seven-cell structure.
- Framerail tests assert the seven-cell WIKIDOT output, shared page/file timeline ordering, F flag, radios, row ids, selectors, localized labels, V/S affordances without file rollback, `.odate`, and existing History behavior.
- Theme Lab tests assert registry coverage, CSS discovery for History/Files, quarantining of uncertified/unmatched findings, continued actions for certified scopes, independent dependency actions, and synthetic-state status.
- Existing port packages, candidate CSS, and accepted screenshot corpus are unchanged by the History repair.
