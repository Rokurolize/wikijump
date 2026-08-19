# Wikidot social resource resolution

- **Shim:** `RenderService::resolve_wikidot_social_requirements` and `render_wikidot_social_module`.
- **Why this lives in Wikijump:** FTML owns the deterministic `[[social ...]]` grammar and emits a typed `SocialRequirement`, while final rendering still needs caller-owned page-preview versus saved-page URL selection, site display data, and browser `document.title` behavior. Deepwell is the first layer with that context.
- **Why FTML alone is insufficient:** FTML cannot know the caller's final page URL, site display name, or browser title. The FTML boundary therefore carries only renderer-generated marker identity plus typed provider and empty-slot selections.
- **Evidence:** FTML `tests/fixtures/wikidot-parity/references-20260819-01.jsonl` and the `social-*` parity fixtures freeze anonymous read-only Wikidot PagePreview observations for default, selected, unknown, mixed, and case-invalid provider slots. Deepwell tests the same typed requirement in page-preview and saved-page contexts.
- **Backlog decision:** accepted caller-runtime compatibility boundary, not parser debt. Provider-token grammar remains FTML-owned; URL/title/site/browser expansion remains Wikijump-owned.
- **Migration condition:** shrink this shim only if FTML gains an explicit caller-provided resource-resolution interface for page URL, site data, and browser action context.
- **Owner:** Wikijump render compatibility.
- **Review trigger:** any FTML Social requirement schema change, Wikidot Social evidence change, or FTML dependency pin update.
