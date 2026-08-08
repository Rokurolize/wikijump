# Local administration module policy

Wikijump's local Wikidot emulator administers only the current local site.
`ManageSite` and `Dashboard` may link to the local administration surface, but
cross-site and platform-global mutations are intentionally unavailable.

The following module families must never turn captured Wikidot markup into a
remote write:

- `Clone` does not copy from or create a remote site;
- `PetitionAdmin` does not submit to Wikidot platform administration;
- global `SiteGrid` does not enumerate private or remote platform state;
- missing actor/site context renders an unavailable or permission error rather
  than widening to every site.

A future implementation may add a local, explicitly selected source/target
workflow, but it must use local site identities, ordinary authorization, CSRF,
and an atomic database transaction. It is not part of Wikidot network parity.
