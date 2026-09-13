# Site favicons

- Feature ID: `favicons`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Site favicons” and its user-visible configuration, state, permissions, and output.

## Implementation contract

- The public route, UI, persistent state, permissions, and user-visible side effects MUST match the documented contract.
- Account, site, category, page, and actor context MUST be enforced at the public service boundary.
- Browser behavior MUST be tested when the feature exposes navigation, dynamic controls, or intermediate visible states.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Configured Windows 8 Tile declares a fixed local route and meta element

- Observation ID: `windows-tile-declaration-20260913`
- Classification: `documentation-omission`
- Observed at: `2026-09-13`
- Analysis: A run-owned mutation on sandbox-for-codex uploaded one 144x144 PNG to the Windows 8 Tile slot, captured the anonymous public head and the declared site-local route with GET and HEAD, then deleted the tile and re-verified the unconfigured head. The unconfigured baseline and after-revert captures are the negative control.

Normative behavior:

- A configured Windows 8 tile appends one meta element to the public head after the iOS touch icon declarations: <meta name="msapplication-TileImage" content="/local--wp8icon/wp8icon.png"/>.
- The declaration content is the fixed site-local route /local--wp8icon/wp8icon.png. It does not expose the configured source.
- Wikidot serves that route with HTTP 200 for GET and HEAD, content-type image/png; charset=utf-8, cache-control maxage=3600, public max-age=3600, and an ETag. The served bytes equal the uploaded image bytes.
- An unconfigured site emits no msapplication meta element, and deleting the tile removes it.
- The Windows tile background color is a separate setting. No msapplication-TileColor element was observed with the default color and must not be inferred.

Evidence:

- `install/local/wikidot-verification/artifacts/m756-windows-tile-live-20260914.json` (SHA-256 `20be4e14d8addc6340664e0ad765bb0eec85dcf047dbb0c7f1c203a34e3396d7`), cases: none



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:146` through line 150 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:146` through line 150  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0146 +++ FAVICONS
L0147 You can choose your own favicon for your site instead of the default. Favicon is an icon of the site which can be seen in the title bar of your Web Browser. Very nice thing :)
L0148 
L0149 
L0150 
```
