# Windows tile public-output seam map

Referent table: `docs/development/referent-table-open43-m-windows-tile-seam-map.md`

Referent table SHA-256: `86cc554e415f27a4c67602786fe1a2a9fac64fceb4f6e7bcb2a8859a372e9ae1`

## Evidence boundary

| Evidence | Identity | What it proves | What it does not prove |
| --- | --- | --- | --- |
| `E_ICON_PANEL` | `/mnt/oracle-store/wjlab/sandbox-oracle-20260722/site-settings-scope-v1/admin-panels-v3/sm-icons.html`, SHA-256 `0ca59cf68a5179ccb8e655d345829a16cff7252ca22144319a2c9935b114507b` | Live Wikidot exposes a Windows 8 Tile image slot through `ManageSiteWindowsIconModule`, local upload, and existing-URL controls. | It does not contain a configured tile, a public-page head element, a site-local tile path, or a route response. |
| `E_ICON_OBSERVATIONS` | `/mnt/oracle-store/wjlab/sandbox-oracle-20260722/site-settings-scope-v1/admin-panels-v3/observations.json`, SHA-256 `c1d5e0ccebe29384487a9d0c7a9fe0962d2a41a26569c5c084b65f23e7ef1299` | The observed admin panel and its field/action inventory are bound to one authenticated sandbox capture. | It does not record public head output or an HTTP request for a configured Windows tile. |
| `E_ICON_SCOPE` | `/mnt/oracle-store/wjlab/sandbox-oracle-20260722/site-settings-scope-v1/icon-setting-v1/scoping-verdict.json`, SHA-256 `bb73af6a64011df8d87b0766032ae63c2cbdee4e0cb845b62bdb2e2bea38cd15` | The prior live setting investigation established the icon setting scope and one favicon route observation. | It does not establish a Windows tile declaration or route. |

The configured Windows tile output is therefore not observable from the campaign's frozen evidence. The read-only public-page probes attempted on 2026-08-09 found no configured Windows tile declaration. An unconfigured page cannot establish the positive declaration shape or pathname.

## Public seams

| Boundary | Existing public seam | Required independent expected value | Current decision |
| --- | --- | --- | --- |
| SSR head | `framerail/src/routes/+layout.svelte` receives `data.site.windows_tile_source` through the ordinary public page preload. | The exact `meta` name, attribute order-insensitive attribute set, and content path emitted by a configured live Wikidot page. | Resolved. The live capture appends `<meta name="msapplication-TileImage" content="/local--wp8icon/wp8icon.png"/>` after the iOS icon declarations. |
| Site-local HTTP route | A new SvelteKit route delegates GET and HEAD to `siteIconResponse(request, (site) => site.windows_tile_source, "windows")`. | The exact site-local route pathname and configured live response behavior. | Resolved. Live serves `/local--wp8icon/wp8icon.png` with 200 GET/HEAD, `image/png`, `cache-control: maxage=3600, public max-age=3600`, and an ETag; Wikijump projects it through the same safe redirect boundary as the favicon and iOS routes. |
| Focused Node test | `framerail/tests/site-icons.test.js` and a route contract test can exercise the declaration helper and public handler once the public values are known. | The configured positive declaration and route pathname from evidence independent of Wikijump source. | Resolved. Positive, negative, and cross-kind declaration cases run under the Framerail unit runner, and the retained capture is byte-sealed by `install/local/wikidot-verification/tests/m756-windows-tile-evidence.test.mjs`. |

## Source audit

`framerail/src/lib/site-icon-source.ts` already accepts the `windows` source kind and restricts it to a same-site local-file source for both local and imported sites. It intentionally has no imported Wikidot fixed-route prefix for Windows because no such route has been observed. `framerail/src/lib/server/site-icon-response.ts` is the reusable 404-or-safe-302 response boundary. `framerail/src/lib/site-icons.ts`, `framerail/src/routes/+layout.svelte`, and the route tree have no Windows tile output.

No production or test change is supported by the available evidence. `M756_WINDOWS_TILE_DECLARATION` must be classified as `blocked_evidence` until a read-only configured live Wikidot page freezes the exact head element and its requested site-local route. The existing safe-source policy remains source-ready; upload materialization, local owned bytes, and browser cache transitions remain separate subrows.

## Observed contract (2026-09-13)

A run-owned mutation uploaded one 144x144 PNG to the Windows 8 Tile slot on `sandbox-for-codex`, captured the anonymous public head, requested the declared site-local route with GET and HEAD, deleted the tile, and re-verified the unconfigured head. The unconfigured baseline is the same-site negative control.

- Declaration: `<meta name="msapplication-TileImage" content="/local--wp8icon/wp8icon.png"/>`, appended after the iOS touch icon declarations.
- Route: `/local--wp8icon/wp8icon.png`, 200 for GET and HEAD, `image/png; charset=utf-8`, `cache-control: maxage=3600, public max-age=3600`, ETag, and the uploaded bytes.
- Cleanup: the delete action returned `ok`, the public meta disappeared, and the head elements matched the unconfigured baseline.
- Background color remains a separate setting; no `msapplication-TileColor` element was observed and none must be added.

Evidence: `install/local/wikidot-verification/artifacts/m756-windows-tile-live-20260914.json`, SHA-256 `20be4e14d8addc6340664e0ad765bb0eec85dcf047dbb0c7f1c203a34e3396d7` (source run receipt `/home/roku/wjlab/evidence/m756-windows-tile-20260914-r1/verdict.json`, SHA-256 `f11c7c2d0fa46e3a3986338d17544914a1a436ea9e528ff35e62da5a2d0d86ca`).
