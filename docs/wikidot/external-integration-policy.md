# External integration policy

Wikijump's local Wikidot emulator does not execute third-party tracking code.
In particular, a Wikidot Google Analytics profile is not emitted into the
served document, does not load `ga.js` or `gtag.js`, and does not send an
analytics beacon.

This is an intentional product boundary rather than a temporary missing
setting. Imported page source and site metadata may record that the original
site used an external integration, but rendering that metadata must remain
inert unless a local, permission-aware and network-safe adapter is implemented
for that integration.

The same rule applies to externally hosted executable widgets: compatibility
code may render an evidenced unavailable state or a sanitized passive link,
but it must not reproduce remote scripts, Flash payloads, tracking pixels, or
arbitrary browser-executable URLs merely to imitate the live site.

## Browser-direct external theme resources

An external theme is a browser-direct stylesheet reference. Wikijump admits it only after the stored URL passes the HTTPS and host allowlist, and the served document's CSP provides the corresponding `style-src` boundary. Framerail emits a normal `<link rel="stylesheet">`; it does not fetch, proxy, or rewrite the stylesheet response.

The browser owns redirect, request-timeout, response-MIME, and transfer-size failures. A failed external stylesheet remains a browser resource failure; the server does not inspect the response or synthesize a substitute. Wikijump owns URL admission, CSP, and effective-theme freshness: invalid or disallowed values resolve to the built-in Base descriptor, and a changed or failed external theme must not reuse the previous category or site stylesheet. Browser cache behavior does not authorize stale reuse by Wikijump.
