---
name: wikidot-py-operations
description: Operate Wikidot through the local Rokurolize/wikidot.py fork, including authentication, sites, pages, source, metadata, revisions, votes, files, forums, members, applications, users, private messages, QuickModule lookup, raw Ajax Module Connector requests, batching, retries, and transport security. Use when Codex must read or mutate Wikidot with the wikidot.py library or call ajax-module-connector.php without reimplementing session handling. This skill is not the source of truth for Wikidot's API-key XML-RPC API; route that work to the project's scripts/WIKIDOT_API.md.
---

# Wikidot.py Operations

Use `/home/roku/src/Rokurolize/wikidot.py` as the source of truth. Use `$wikidot-sandbox-access` first whenever credentials, sandbox selection, account roles, or mutation boundaries matter.

## Scope boundary: wikidot.py versus Wikidot XML-RPC

Do not conflate these two interfaces:

- **This skill:** the local `wikidot.py` Python library, its authenticated session, Ajax Module Connector (AMC), high-level page/forum/member objects, and the library's retry/transport behavior.
- **Wikidot API:** the API-key-only XML-RPC service (`system.*`, `pages.*`, `files.*`, `users.*`, `posts.*`). Its source of truth in the SCP corpus project is [`scripts/WIKIDOT_API.md`](/home/roku/src/Rokurolize/scp-wiki-translation/scripts/WIKIDOT_API.md), not this skill.

Route requests as follows:

| User asks about | Read/use |
| --- | --- |
| `wikidot.py`, AMC, session login, high-level `Client`, or Ajax fallback | This skill and `/home/roku/src/Rokurolize/wikidot.py` |
| API key, XML-RPC endpoint, `system.listMethods`, XML-RPC signatures, or XML-RPC method fields | Project `scripts/WIKIDOT_API.md` first; then the relevant `docs/` and `scp_wiki_wikidot/` implementation |
| `corpus_sync` XML-RPC capture or completeness | Project `scripts/WIKIDOT_API.md` plus the applicable corpus-sync design; use this skill only for an explicitly requested `wikidot.py` fallback/operation |

The project package `scp_wiki_wikidot/` is an adapter layer: some corpus-sync paths use XML-RPC, while selected API-disabled paths may fall back to `wikidot.py`. Verify which transport the command selects before citing or changing behavior.

## Standard workflow

1. Read [environment-and-auth.md](references/environment-and-auth.md) before authenticated work or the first use from a new shell.
2. Read [high-level-operations.md](references/high-level-operations.md) for supported object operations and recipes.
3. Prefer the high-level API. Read [raw-ajax.md](references/raw-ajax.md) only when no high-level operation exists or exact AMC behavior is the subject of the task.
4. Read [source-routing.md](references/source-routing.md) when an API detail is uncertain or the local fork may have changed.
5. Perform read-only discovery first. Apply the mutation boundaries from `$wikidot-sandbox-access`, use a run-owned page for destructive tests, and verify mutations by reading the target back.

## Execution

Run the repository-pinned environment from any current directory:

```bash
/home/roku/.codex/skills/wikidot-py-operations/scripts/wikidot-python -c 'import wikidot; print(wikidot.__version__)'
/home/roku/.codex/skills/wikidot-py-operations/scripts/wikidot-python /absolute/path/to/task.py
```

The wrapper delegates to `uv run --project /home/roku/src/Rokurolize/wikidot.py python`. Do not install into system Python. Set `WIKIDOT_PY_REPO` only when deliberately testing another checkout.

## Decision rules

| Need | Use |
| --- | --- |
| Public page, site, user, forum, or search read | `wikidot.Client()` and the high-level API |
| Authenticated read or mutation | Load one account with `$wikidot-sandbox-access`, then construct `wikidot.Client(username=..., password=...)` |
| Page publication with tags, parent, metadata, or source verification | `site.page.publish(...)` |
| Many reads | Collection bulk methods, `site.pages.iter_search`, `site.pages.iter_sources`, or `site.amc_request_with_retry(...)` |
| Known AMC module or action not wrapped by the library | `site.amc_request(...)` |
| Member, user, or page autocomplete lookup | `wikidot.QuickModule` |
| HTTP-only authenticated site | Refuse by default; use the exact-site transport opt-in only after explicit authorization |

Never print credentials, the `WIKIDOT_SESSION_ID` cookie, raw authenticated headers, or unredacted request bodies containing private text. Close clients with a context manager.
