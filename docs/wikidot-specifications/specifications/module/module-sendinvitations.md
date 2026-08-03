# SendInvitations Module

- Feature ID: `module-sendinvitations`
- Category: `module`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the `SendInvitations` module interface, attributes, defaults, selection or side-effect behavior, templates, output, and documented limitations.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### SimpleToDo initial preview rendering and globally disabled SendInvitations output

- Observation ID: `simpletodo-sendinvitations-live-preview-basics`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: The SendInvitations documentation describes the historical invitation form, but live Wikidot currently renders only a disabled-abuse notice for anonymous and authenticated account-A PagePreviewModule probes. The SimpleToDo documentation describes an interactive persisted task list, but live preview evidence establishes the missing-id error and the initial empty-list shell for a new id; task persistence and edit controls remain a separate stateful action surface.

Normative behavior:

- SendInvitations renders a div.error-block saying invitations are disabled due to severe abuse and links to /_admin.
- SendInvitations observed output is identical for anonymous and authenticated account-A PagePreviewModule probes.
- SimpleToDo with omitted id or id="" renders div.error-block with the text The SimpleTodo module must have an id.
- SimpleToDo with an id renders the initial simpletodo-box shell with default title Here is a place for your title, default task text Click me to edit !, default task text Drag me !, a label containing the id, and simpletodo-data edit-permission false in PagePreviewModule.
- SimpleToDo anonymous and account-A PagePreviewModule output was identical for the observed initial id case.
- SimpleToDo task mutation, persistence, saved-page edit permission, and browser drag/drop behavior remain unimplemented until a stateful live action surface and data model are added.

Evidence:

- `install/local/wikidot-verification/artifacts/simpletodo-sendinvitations-live-preview.json` (SHA-256 `d26c44a0de21437a0c344244f0b7d24778a5e66b5c24bb1839dfe546ec2df095`), cases: `simpletodo-missing-id`, `simpletodo-empty-id`, `simpletodo-id-initial`, `sendinvitations-disabled`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- Module names and attribute names are compatibility-sensitive and must not be modernized.
- Examples are acceptance-test inputs, not permission to infer behavior beyond the documented case.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:sendinvitations-module/source.wikidot.txt:1` through line 17 (canonical)

## Documentation-derived behavioral evidence

### doc-modules:sendinvitations-module (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:sendinvitations-module/source.wikidot.txt:1` through line 17  
SHA-256 of complete source file: `1422a79549200a9f71f33d41590b7cb8a4c333b1bcb3ac54ec73babed4f34978`

```wikidot
L0001 ++ Description
L0002 
L0003 Allows Members of a Wiki to send email invitations to their friends/coworkers to join the Wiki. This is a nice thing if you want your community to grow quickly.
L0004 
L0005 For the module to work it must be enabled under Site Manager >> Members >> Let Users invite
L0006 
L0007 ++ Attributes
L0008 
L0009 No attributes required.
L0010 
L0011 ++ Examples
L0012 
L0013 [[code]]
L0014 Invite your friends to this Wiki!
L0015 
L0016 [[module SendInvitations]]
L0017 [[/code]]
```
