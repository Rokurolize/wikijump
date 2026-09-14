# Site themes

- Feature ID: `site-themes`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Site themes” and its user-visible configuration, state, permissions, and output.

## Implementation contract

- The public route, UI, persistent state, permissions, and user-visible side effects MUST match the documented contract.
- Account, site, category, page, and actor context MUST be enforced at the public service boundary.
- Browser behavior MUST be tested when the feature exposes navigation, dynamic controls, or intermediate visible states.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Persisted built-in theme ids serve exact ordered versioned common--theme stylesheets

- Observation ID: `built-in-theme-asset-mapping-20260914`
- Classification: `documentation-omission`
- Observed at: `2026-09-14`
- Analysis: An authenticated run-owned mutation on sandbox-for-codex saved each persisted appearance id into a run-owned category, read the category back, and fetched the representative document through the authenticated document seam (x-wikidot-static-cache: BYPASS). The render's inline <style type="text/css" id="internal-style"> block was reduced to its ordered common--theme/<dir>/css/style.css URL set. The saved panel holds 29 built-in ids and 13 site custom ids. The authenticated render is authoritative; the anonymous path-keyed static cache can serve a stale mapping for its lifetime. The run restored the category to theme_default=true, theme_id=1, theme_external_url="" and verified the authoritative render matched the pre-run baseline.

Normative behavior:

- The saved appearance panel persists 29 built-in theme ids. Ids 8248876 through 8248888 are site custom themes (bootstrap-base plus local--theme/<dir>/style.css on the site file host) and must not be exposed as built-in themes.
- For every built-in id, the served stylesheet set is the ordered common--theme/<dir>/css/style.css URL list recorded in the pinned artifact. Base is served first when present and a variant appends its own directory after its parent; theme 162746 (Bootstrap Base) serves bootstrap-base alone.
- The observed asset URLs use the versioned origin http://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--theme. The directory set and its ordering are the mapping authority for each persisted id.
- The live document emits those assets as inline @import url(<url>); statements inside <style type="text/css" id="internal-style"> in the same order as the directory list; no stylesheet link carries a built-in theme asset.
- The authenticated document fetch renders the saved category state immediately, while the anonymous public document can serve a stale mapping for the static-cache lifetime. The authenticated stored-category render is the mapping authority.
- Missing-resource fallback was not observed: the capture did not exercise an unavailable theme asset. Local behavior must not invent a substitute asset, and an unmapped persisted id remains Base.

Evidence:

- `install/local/wikidot-verification/artifacts/s755-built-in-theme-asset-mapping-20260914.json` (SHA-256 `9d846ead9aaee97ff618663576e82d86273f2beb1094811a8a8d6c359b9ed3d8`), cases: none

### External theme resource failures use browser-direct loading

- Owner decision: `S755_EXTERNAL_RESOURCE_FAILURE_POLICY` in `/home/roku/wjlab/decisions-required-20260914.md`, resolved `2026-09-15`.
- An accepted external theme URL is emitted directly to the browser as a stylesheet link. Wikijump must not fetch, proxy, rewrite, or inspect the remote stylesheet response.
- The browser owns redirects, request timeouts, response-MIME failures, and transfer-size failures. The browser's resource failure remains observable as a resource failure; Wikijump must not invent a server-side failure presentation or substitute response bytes.
- Wikijump owns the HTTPS and host allowlist, the CSP `style-src` boundary, and effective-theme freshness. Invalid or disallowed URLs resolve to the built-in Base descriptor, and a changed or failed external theme must not reuse the previous category or site stylesheet.
- Browser cache behavior remains browser-owned; it does not authorize stale theme reuse by Wikijump. This policy defines failure ownership without claiming an unobserved browser-specific error DOM.



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:116` through line 120 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:116` through line 120  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0116 +++ THEMES
L0117 Themes can be assigned to each of categories within a site separately. You can also use your own custom themes (CSS-based). Check out our simple [http://www.wikidot.com/themes:preview theme previewer] (we will add new themes soon!). More themes are on their way.
L0118 
L0119 
L0120 
```
