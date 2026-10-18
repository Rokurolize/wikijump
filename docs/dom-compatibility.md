## DOM Compatibility

DOM compatibility is a required part of this fork's Wikidot-emulator contract, not an optional migration aid. For every browser surface exposed by live Wikidot, the Wikidot layout and browser-facing routes must preserve the observable tree structure, element order, IDs, classes, attributes, CSS cascade, interactions, navigation states, intermediate visible states, and settled layout. Controlled live Wikidot observations are canonical when documentation or local output disagrees.

No UI category is exempt from compatibility in advance. Login and logout, user settings, site administration, user profiles, page editing, and page options are all required observation surfaces and must be reproduced from evidence rather than assigned replacement markup merely because themes or customization are limited there.

The existence of another internal layout or a transition mechanism does not relax the `Layout::Wikidot` contract and must not change imported-content behavior. Unverified compatibility behavior must remain unspecified until controlled evidence is collected; implementations must not invent replacement markup or silently redesign the interface. Once controlled evidence establishes a Wikidot behavior, that observed boundary remains the compatibility target even when it is less defensive than a modern implementation would normally choose. Unverified behavior still fails closed; verified concerning behavior is documented in `wikidot-compatibility-security.md` and reproduced rather than silently hardened.

The `wj-` prefix is Wikijump's own naming and is not part of that contract. Wikidot names its DOM `collapsible-block`, `footnotes-footer`, `footnoteref`, `toc0`, `yui-navset`; the fork renamed much of it to `wj-collapsible`, `wj-footnote-list` and so on. No `wj-` class, tag, id, or `data-wj-` attribute may reach the browser for imported content. Such an identifier is both a tree difference and an unstyled element, because the Wikidot stylesheet the page loads contains no `.wj-` rules at all.

Two mechanisms keep it out. FTML branches on `Layout::Wikidot` and emits the native name, which is where a syntax-level difference belongs, and the restorers under `deepwell/src/services/render/compat/` rewrite what still survives into Wikidot's markup. Prefer the first: a new construct should be corrected in the syntax renderer rather than by another post-render rewrite. Wikijump-only blocks with no Wikidot counterpart, such as `[[hidden]]` and `[[invisible]]`, are a third case and correctly remain literal under the Wikidot layout instead of rendering into any markup.

`pnpm --dir install/local/wikidot-verification wikijump-identifier-leaks -- --site <slug>` renders a battery of constructs through the local runtime and fails on any such identifier. It needs a running local stack and creates no page. Run it when adding or changing a rendered construct; a hand-written negative assertion per construct only guards the constructs somebody remembered.

An intentional behavior that is stricter than an established Wikidot oracle is a product divergence, not compatibility. For this local-only compatibility target, such a divergence requires an explicit product decision; security or robustness alone is not sufficient reason to keep it. Concerning Wikidot behavior should instead be recorded with provenance in `wikidot-compatibility-security.md` and covered by regression evidence so future maintainers do not "fix" the emulator away from its oracle.


## Foldable components with CSS-controlled sibling content

- Foldable controls toggle the owning `li` between `folded` and `unfolded`
  even when the content is styled through sibling `div` elements rather than
  a nested `ul`. The retained Wikidot `_foldableMenuToggle` changes the class
  before looking up the first descendant list. The shared corpus's
  `en/pages/info:start/source.wikidot.txt` (capture
  `0cb35933824447284e15a1dcaa29e1c32f150f44b7233662268b07d88f808b21`,
  run `run-20261011-230158`) uses precisely this sibling structure. This
  class transition is what lets the component stylesheet reveal its modal
  and fader. Browser state and keyboard handling belong to Framerail.
  Retained script: `/home/roku/.cache/wikijump-verification/manual-public-evidence/WIKIDOT.combined-v--7690939296dc.js`
  (gzip bytes SHA-256 `376ae615e4d8e31580b030e57ffc2704acba601b6e461956def6a58bd9c068cc`).
  Offline regression: `framerail/tests/wikidot-foldable-lists.spec.ts`,
  including independent dialogs with no nested list or unique panel ID.

The same `info:style` corpus capture uses a 105 ms opacity/visibility
transition. A newly unfolded dialog may still have computed hidden visibility
in the opening event. Framerail focuses its close control after it is revealed;
closing, replacement or action destruction must cancel pending focus work. The
foldable browser regression retains this transition and checks cancellation.
