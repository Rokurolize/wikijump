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

