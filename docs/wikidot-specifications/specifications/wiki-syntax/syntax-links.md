# Links syntax

- Feature ID: `syntax-links`
- Category: `wiki-syntax`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Parse and render Wikidot's documented links syntax, including every documented form, option, output rule, and limitation.

## Implementation contract

- The parser MUST recognize every documented spelling and structural form in the evidence below.
- The renderer MUST produce the described visible text, HTML structure, links, and context-sensitive behavior.
- Whitespace, escaping, nesting, and malformed-input behavior MUST follow explicit documentation; unspecified cases require oracle evidence before widening acceptance.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Detailed conformance contract

- Status: `detailed-p1-p8`
- Source-gap snapshot: Wikijump `257f6a3936976f1a6ea5094ae0cee5ac12777495`
- Evidence manifest: `docs/wikidot-specifications/detailed-spec-evidence-20260816.json`

This section is normative. It maps the complete evidence below to every P1-P8
implementation axis. A statement that deliberately keeps an unobserved path
fail-closed is a boundary of the specification, not permission to invent the
missing Wikidot behavior.

Evidence basis:

- `current-www-source` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/live-www-source-pages.jsonl` (SHA-256 `53ffba0adb068777ad023eb46dabb59756223fc13ab10d7c9b4a82042b276ffc`): All 46 current www.wikidot.com source pages referenced by the 57 hardened features were found and all 46 source hashes matched the frozen documentation corpus.
- `syntax-pagepreview` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/syntax-preview-references.jsonl` (SHA-256 `6633d6e691ff0952309e50fdc9a72dd5bcba5df07035b89bc140e23e1dd9519a`): Seventeen anonymous PagePreview probes cover embedding, iframe filtering, foldable-list initial DOM, links, and social-bookmarking boundaries.

### P1 - invocation grammar and scalar interpretation

- Support documented triple-bracket internal links, external links, single-bracket links, empty links, anchors, email links, InterWiki forms, magic URI path options, and hash fragments with their documented custom-text/new-window forms.

### P2 - parser stage, nesting, and composition

- Internal page-name purification, category prefixes, fragments, and custom labels are parsed as link syntax. Link-like text inside literal/code ownership MUST remain literal according to the surrounding syntax contract.

### P3 - lifecycle, persistence, import, and round trips

- Links are render/navigation constructs and do not mutate destination pages. Magic URI options affect the destination request/editor state only when that route is activated.

### P4 - actors, permissions, visibility, and privacy

- Rendering a link MUST NOT reveal whether a destination is private beyond the documented newpage/existing-page presentation available to that actor. Email scrambling must not expose the plain address to simple source scraping beyond the authored source itself.

### P5 - selection, ordering, counting, and pagination

- Links have no independent pagination; authored link order is preserved.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Live examples confirm internal missing link /some-page with class newpage, external * link target=_blank, empty link href=javascript:;, InterWiki Wikipedia URL with new-window onclick, and ordinary fragment anchors for both #_editpage and an unknown #_notawikidotcommand. Runtime hash-magic action handling is separate from anchor rendering.

### P7 - DOM, CSS, resources, interaction, and geometry

- Email syntax renders as span.wiki-email with scrambled visible text. Anchor href/text/target/class and InterWiki onclick behavior are compatibility-sensitive at the rendered DOM boundary.
- For new-window anchors, live Wikidot emits target="_blank" without a rel attribute. The local runtime deliberately adds rel="noopener noreferrer" as an accepted security divergence (reverse-tabnabbing hardening); see the syntax-links-noopener-security-divergence-20260817 live observation. This hardening is not exact DOM parity and must not be silently removed or silently presented as Wikidot-identical.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Malformed or unsupported magic options MUST NOT acquire mutation authority. Navigation/back-forward behavior follows the resulting URL; render-time recognition must remain deterministic and safe under unusual characters and escaping.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Wikidot new-window links carry no rel; the local runtime adds an accepted noopener hardening

- Observation ID: `syntax-links-noopener-security-divergence-20260817`
- Classification: `documentation-correction`
- Observed at: `2026-08-17`
- Analysis: Frozen anonymous Wikidot PagePreview evidence for the single-bracket external new-window form [*https://example.com/ Example] renders <a href="https://example.com/" target="_blank">Example</a> with no rel attribute. The local runtime renders the identical anchor with an additional rel="noopener noreferrer" hardening. This is a deliberate security divergence: removing the hardening to byte-match live Wikidot would weaken reverse-tabnabbing protection for byte-equivalence, which the compatibility charter does not permit. The divergence is classified as an accepted security divergence and is not exact Wikidot parity.

Normative behavior:

- Live Wikidot renders new-window external links as target="_blank" anchors without a rel attribute.
- The local runtime preserves the rel="noopener noreferrer" hardening on the same anchors as an accepted security divergence.
- The divergence is a deliberate security hardening, not exact DOM parity; it must not be silently removed, and it must not be silently presented as Wikidot-identical.

Evidence:

- `/home/roku/wjlab/evidence/spec-hardening-20260816/syntax-preview-references.jsonl` (SHA-256 `6633d6e691ff0952309e50fdc9a72dd5bcba5df07035b89bc140e23e1dd9519a`), cases: `spec-syntax-link-external-new-window`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:links/source.wikidot.txt:1` through line 94 (canonical)

## Documentation-derived behavioral evidence

### doc-wiki-syntax:links (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:links/source.wikidot.txt:1` through line 94  
SHA-256 of complete source file: `22e8b6bbda038987f62d212a21966bfc09c93ed02b1c0ebb6d288eacd3380646`

```wikidot
L0001 ++ [[# internal]]Internal links
L0002 
L0003 Unlike some other wiki engines Wikidot.com does not process SquashedAndCapitalized words as page links. Instead any link should be marked with 3 nesting square brackets.
L0004 
L0005 If a page address contains disallowed characters the address will be "unixified" to contain only allowed chars. The displayed name however will maintain original form.
L0006 
L0007 ||~ what you type ||~ what you get||~ comments||
L0008 || {{@@[[[link-to-a-page]]]@@}} || [[[link-to-a-page]]] || using raw page name ||
L0009 || {{@@[[[link "TO" a; pagE]]]@@}} || [[[link "TO" a; pagE]]] || automatic purification of destination page||
L0010 || {{@@[[[category: sample page]]]@@}} || [[[category: sample page]]] || linked to a page with category ||
L0011 || {{@@[[[some page| custom text]]]@@}} || [[[some page| custom text]]] || using custom text ||
L0012 || {{@@[[[doc|Documentation]]]@@}} || [[[doc|Documentation]]] || linking to an existing page (different color) ||
L0013 || {{@@[[[some page|]]]@@}} || [[[some page|]]] || using page title as link text ||
L0014 || {{@@[[[doc#toc1|Section 1]]]@@}} || [[[doc#toc1|Section 1]]] || linking to an anchor (first section)||
L0015 || {{@@[[[doc#toc1]]]@@}} || [[[doc#toc1]]] || linking to an anchor (first section) ||
L0016 ||{{@@[[[/| Home]]]@@}} || [[[/|Home]]] || links to your home page ||
L0017 
L0018 ++ [[# urls]]URLs
L0019 
L0020 ||~ what you type ||~ what you get||~ comments||
L0021 || {{@@[[[http://www.wikidot.com | Wikidot]]]@@}} || [[[http://www.wikidot.com | Wikidot]]] || named link (custom anchor) ||
L0022 || {{@@[[[*http://www.wikidot.com | Wikidot]]]@@}} || [[[*http://www.wikidot.com | Wikidot]]] || named link (custom anchor), opened in new window/tab ||
L0023 || {{@@[[[/category:page/option1/option2 | link text]]]@@}} || [[[/category:page/option1/option2 | link text]]] || You can create shorter links to your own site with _
L0024 parameters without writing whole http link. _
L0025 E.g. you can use _
L0026 {{@@[[[/blog:post/edit/true | edit this post]]]@@}} _
L0027 instead of _
L0028 {{@@[[[http://site.wikidot.com/ blog:post/edit/true | edit this post]]]@@}} ||
L0029 || {{@@http://www.wikidot.com@@}} || http://www.wikidot.com || simple inline link ||
L0030 || {{@@[http://www.wikidot.com wikidot]@@}} || [http://www.wikidot.com wikidot] || named link (custom anchor) ||
L0031 || {{@@*http://www.wikidot.com@@}} _
L0032 {{@@[*http://www.wikidot.com wikidot]@@}} || *http://www.wikidot.com _
L0033 [*http://www.wikidot.com wikidot] || opens in a new window ||
L0034 || {{@@[[a href="http://www.wikidot.com"]] Wikidot[[/a]]@@}} || [[a href="http://www.wikidot.com"]]Wikidot[[/a]] || You can use classes and data-* parameters ||
L0035 || {{@@[# empty link]@@}} || [# empty link] || link with {{href="javascript:;"}} i.e. not leading anywhere. useful when constructing pull-down menus||
L0036 || {{@@[/category:page/option1/option2 link text]@@}} ||  [/category:page/option1/option2 link text] || You can create shorter links to your own site with _
L0037 parameters without writing whole http link. _
L0038 E.g. you can use _
L0039 //@@[/blog:post/edit/true edit this post]@@// _
L0040 instead of _
L0041 //@@[http://site.wikidot.com/ blog:post/edit/true edit this post]@@// ||
L0042 
L0043 Adding underscore to **a** element **@@[[a_ ]]@@** will truncate whitespaces around it which prevents creation of random [[[doc-wiki-syntax:paragraphs-and-newline | new lines and paragraphs]]]. It's simplifices creation of complex HTML syntax like [[[http://getbootstrap.com/components/ | Bootstrap components]]]
L0044 
L0045 ++ [[# anchors]]Anchors
L0046 
L0047 To place an anchor use {{@@[[# anchor-name]]@@}} syntax. To refer to an anchor (and scroll to it) use {{@@[#anchor-name text to display]@@}}.
L0048 
L0049 ++ [[# emails]]Emails
L0050 
L0051 ||~ what you type ||~ what you get||~ comments||
L0052 || {{@@support@example.com@@}} || support@example.com || simple inline email ||
L0053 || {{@@[support@example.com email me!]@@}} || [support@example.com email me!]|| custom anchor ||
L0054 
L0055 Although we discourage anyone from putting his/her email address on the web, Wikidot engine provides a simple scrambling mechanism to prevent automated bots from reading emails. Each email is scrambled and it is decoded in the client's browser. So it is not 100% spam-safe, but much safer than plain-text emails.
L0056 
L0057 ++ [[# interwiki]] InterWiki
L0058 
L0059 To link directly to a Wikipedia article you can use a syntax:
L0060 
L0061 ||~ what you type ||~ what you get||
L0062 || {{@@[wikipedia:Albert_Einstein]@@}} || [wikipedia:Albert_Einstein]||
L0063 || {{@@[wikipedia:Albert_Einstein Albert]@@}} || [wikipedia:Albert_Einstein Albert]||
L0064 || {{@@[wikipedia:it:Albert_Einstein Albert]@@}} || [wikipedia:it:Albert_Einstein Albert]||
L0065 
L0066 Other links defined by example:
L0067 * {{@@[google:free+wiki]@@}} - search google for the "free wiki" term
L0068 * {{@@[dictionary:wiki]@@}} - look up definitions of the word //wiki// from dictionary.reference.com
L0069 
L0070 ++ [[# magicuris]] Magic URIs
L0071 
L0072 Magic URIs (or Magic Links) are the way to control pages within the URL address.
L0073 
L0074 ||~ what you type ||~ what you get||~ comments||
L0075 || {{@@[http://site-name.wikidot.com/page-name#_editpage Edit]@@}} || [http://site-name.wikidot.com/page-name#_editpage Edit] || Goes to the page with the edit mode already opened ||
L0076 || {{@@[http://site-name.wikidot.com/page-name/title/whatever Edit with title]@@}} || [http://site-name.wikidot.com/page-name/title/whatever Edit with title set] || Works only with not existing pages. When you go to edit mode on such page, the title will be set to 'whatever'. May be combined with /edit/true, parentPage/page-name etc. ||
L0077 || {{@@[http://site-name.wikidot.com/page-name/parentPage/parent-page-name Edit with parent page set]@@}} || [http://site-name.wikidot.com/page-name/parentPage/parent-page-name Edit with parent page set] || Works only with not existing pages. When you go to edit mode on such page, the parent page will be set to 'page-name'. May be combined with /edit/true, title/whatever etc. ||
L0078 || {{@@[http://site-name.wikidot.com/page-name/noredirect/true Page without redirect]@@}} || [http://site-name.wikidot.com/page-name/noredirect/true Page without redirect] || Turning off redirection, if the [http://www.wikidot.com/doc:redirect-module Redirect Module] is present on the page ||
L0079 || {{@@[http://site-name.wikidot.com/page-name/tags/tag1,tag2 Set tags]@@}} || [http://site-name.wikidot.com/page-name/tags/tag1,tag2 Set tags] || Sets tags on the page via URL, comma-delimited ||
L0080 || {{@@[http://site-name.wikidot.com/page-name/norender/true No Render]@@}} || [http://site-name.wikidot.com/page-name/norender/true No Render] || Goes to the page, but does not render it. It allows to change the source of the page when there is a problem with page functionality ||
L0081 
L0082 ++ [[# hashmagicuris]] Hash Magic URIs
L0083 
L0084 {{@@http://site-name.wikidot.com/page-name@@}}**{{#_option}}**
L0085 
L0086 ||~ what you type ||~ what you get||
L0087 || #_wantedpages || lists Wanted Pages ||
L0088 || #_orphanedpages || lists Orphaned Pages ||
L0089 || #_draftpages || lists Draft Pages on site ||
L0090 || #_editpage || opens Editor ||
L0091 || #_edittags || opens Tag Editor ||
L0092 || #_history || displays History ||
L0093 || #_files || lists Files attached to the page||
L0094 || #_sitetools || opens Site Tools ||
```
