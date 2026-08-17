# Wikidot compatibility security notes

Wikijump's Wikidot-compatibility target is an emulator contract. When controlled live evidence establishes a behavior, reproduce that behavior even when a modern implementation could be stricter, safer, or more resource-conservative. The project is operated locally rather than as a general public Internet service, so compatibility fidelity takes precedence over opportunistic hardening at an established oracle boundary.

This file records compatibility-sensitive behaviors that may look like security or robustness defects to a maintainer. It is not a progress tracker: implementation state belongs to the canonical compatibility ledger. Unverified behavior still remains literal or fail-closed until evidence establishes what Wikidot actually does.

## New-tab links omit `rel` hardening

Live Wikidot renders the external new-window form with `target="_blank"` and no `rel="noopener noreferrer"`. The frozen observation is `syntax-links-noopener-security-divergence-20260817`, with the underlying `test--link--single` parity reference. Adding `rel` changes the DOM contract and therefore is not exact parity.

## Generic anchors preserve Wikidot's `javascript:` normalization

The frozen `test--anchor--xss` PagePreview reference shows Wikidot accepting authored `[[a href="javascript:..."]]` values and applying its own punctuation/whitespace normalization rather than rejecting the scheme. This is a concerning browser-facing behavior, but sanitizing those anchors more aggressively is a compatibility divergence once the live result is known.

## `set-tags` button handlers preserve a raw backslash token

The frozen `tests--fixtures--parity-gaps--wikidot-button-set-tags-backslash` reference renders the authored backslash inside the `onclick` JavaScript string. Extra JavaScript-string escaping changes the observed DOM and handler source. The exact live handler text is the compatibility target.

## `#expr` does not enforce the documented 256-character limit

Anonymous PagePreview observations on August 17, 2026 show expressions of 255, 256, and 257 bytes evaluating, followed by constant-complexity probes through 131072 bytes that also evaluate. The evidence is retained by the `expressions-live-probes`, `expressions-length-probes`, and `expressions-length-boundary-probes` observations. A local 256-byte rejection is therefore an implementation limit, not Wikidot parity. Resource bounds should follow observed Wikidot behavior rather than substituting the obsolete documentation limit.

## Pagepath `Create new` commits before the containing form

The August 17, 2026 `data-form-pagepath-create-new-live-20260817` observation shows that choosing `Create new`, entering a child name, and pressing Enter immediately posts `DataFormAction/newPage`. Wikidot creates an empty child page and updates only the editor's hidden pagepath value; the containing data-form page still has its previous stored source. Cancelling the containing page editor leaves the newly created child page in place. This is intentionally non-transactional from the containing form's perspective. Delaying tree-page creation until the form's Save action, or automatically deleting the child on Cancel, would be safer but would not reproduce Wikidot's observed behavior.

The companion `data-form-pagepath-root-bootstrap-live-20260817` observation shows another side effect at the same boundary. Opening a pagepath editor for a never-used tree does not create `<category>:_root`. Creating the first visible child sends `parent=` as an empty string; that successful action creates both the empty `_root` page and the empty child page. Cancelling the containing data-form edit does not roll either page back.
