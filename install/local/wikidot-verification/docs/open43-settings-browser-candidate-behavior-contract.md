# Open43 settings browser candidate behavior contract

Referent table: `referent-table-open43-settings-browser-candidate-cases.md`

Referent table SHA-256: `92202328f55fd51b9b8bc0f2c9fcf78b1fe8abbce2e31d687dd7296c1502a1d4`

## User-visible goal

One shared candidate command must validate the nine reversible settings and browser cases of the exact sealed non-standing candidate. It must publish a pass only after every fixed case passes and public cleanup succeeds.

## Target

Type: CLI, public HTTPS application, and public Deepwell JSON-RPC.

Launch or access: `pnpm --dir install/local/wikidot-verification candidate-cases -- --case-set open43-settings-browser --candidate-identity <sealed-candidate-parity-identity.json> --private-input <private-settings-input.json> --output-dir <new-evidence-directory>`.

Allowed target: the sealed non-443 `https://scpaiueouiuiuiui.wikijump.localhost:<candidate-port>` origin and its sealed services.

Allowed private fixture: one mode-0600 JSON file that contains the administrator and non-administrator browser storage states or sessions, the expired session, the Deepwell token and endpoint, the TLS CA, the task-owned site, category, and existing-page identities used for the category transition, and a cross-site sentinel ID that a public preflight proves does not resolve. Receipts may contain only stable hashes or non-secret actor and fixture IDs derived from that file.

## User tasks

1. Observe analytics, category themes, toolbar states, and the legacy `/_admin` route at immediate DOMContentLoaded and after completion checks.

2. Mutate analytics, category theme, toolbar, and general settings through public Framerail actions. Drive the general settings stale error and successful save through the public browser form. Without reloading, save the same form again to prove that invalidation applied the fresh settings revision. Then confirm each change through public Deepwell reads and served browser state.

3. Exercise anonymous, non-administrator, cross-site, stale-revision, wrong-origin, expired-session, and administrator settings action outcomes. Confirm that denied requests do not change the subsequent public read.

4. Restore the exact pre-run public settings through public actions.

## Expected observable behavior

The denominator contains exactly these case IDs in this order: `S754_ANALYTICS_INITIAL`, `S754_ANALYTICS_SETTLED`, `S755_THEME_INITIAL`, `S755_THEME_SETTLED`, `S757_TOOLBAR_INITIAL`, `S757_TOOLBAR_SETTLED`, `S1046_ADMIN_INITIAL`, `S1046_ADMIN_SETTLED`, and `S1046_PUBLIC_PERMISSION_CSRF_REVISION_MATRIX`.

Each temporal pair has two distinct observations. The first phase is `domcontentloaded_immediate_observation`. The second phase is `settled` and records successful resource completion.

Analytics observations prove both disabled and enabled server-rendered head states, the exact enabled/profile value, queue order and cardinality, CSP materialization, the visible stale-save error's public code and message hash, the successful admin save, and zero remote analytics requests.

Theme observations prove the expected base/site/page cascade and computed font, background, and foreground values on first paint and after settle. A same-document public navigation from the fixed default-category page to the fixed transition-category page has separate client-immediate and client-settled artifacts. Both must use the target category theme without one frame of the previous theme.

Toolbar observations prove that both disabled and enabled stored states control the server-rendered DOM on the fixed desktop, 767 px, and 479 px viewports. The desktop disabled document remains alive across the public toolbar mutation and then records separate client-immediate and client-settled enabled toolbar counts. The case also binds settled geometry, hit targets, scroll, and focus without a stale toolbar frame.

The legacy `/_admin` observations prove the seven controls in their fixed order for the administrator. The browser edits the public general form, captures the stale-revision failure's public code and visible message hash while the dialog is open, succeeds after reload, then succeeds again without a reload to prove that the invalidated revision reached the form. It preserves the saved public values across the later reload and client navigation. Anonymous and non-administrator contexts receive a denied result without the private settings values.

The permission matrix records the served action status and the next public settings read, including the exact site identity and settings revision. Anonymous, non-administrator, cross-site, stale-revision, wrong-origin, and expired-session requests change neither values nor revision. The expired session returns 401 rather than 500. The administrator request changes only the fixed description and advances the revision exactly once.

The runner closes every browser context and the browser before cleanup begins. Cleanup then uses only public HTTP actions and JSON-RPC reads to prove that the settings snapshot equals the pre-run snapshot. A pass receipt is sealed only after that proof, stable runtime identity, and release of every resource.

## Anti-cheat probes

Reverse or duplicate an initial/settled phase and require rejection.

Omit the disabled analytics or toolbar state, the analytics save/error identity, the immediate or settled category transition, computed theme styles, the mutation-crossing client-immediate toolbar state, toolbar geometry or setting change, or the public general-form stale-error identity and fresh-revision confirmation and require rejection.

Return stale analytics, theme, toolbar, or general settings from a fake public boundary and require rejection. Replace the category client transition with a full document load, return stale initial computed styles, or return a reload URL that differs from the independently planned public URL and require rejection.

Return a successful denied-actor mutation, advance only its revision, change the wrong field for the administrator, return an expired-session 500, or return a successful wrong-origin request and require rejection.

Omit cleanup, drift the runtime identity, duplicate or skip a denominator row, or pre-create the output directory and require the shared runner to reject the run.

Change secret values while preserving public actor IDs and require only the private-input hashes to change in receipts. No secret value may appear in any plan, case receipt, cleanup artifact, or aggregate receipt.

## Evidence required

The output directory contains a sealed run plan, one receipt per fixed case, separate immediate and settled screenshot artifact paths with their hashes, one public cleanup proof, and one aggregate receipt bound to exact source, private input, runtime, and candidate identities.

## Out of scope

`S758_CREATE_INITIAL` and `S758_CREATE_SETTLED` remain outside this CandidateCaseSet because successful create advances a monotonic category allocator that no public cleanup authority can restore. They require a disposable candidate stack lifecycle owner or a normal public category lifecycle authority. The blocked external analytics beacon contract, unobserved built-in theme mapping, unobserved bottom-toolbar DOM, the welcome-page effect, and autocomplete keyboard, focus, loading, error, success, cancel, and navigation frames also remain outside this CandidateCaseSet.
