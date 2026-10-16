# Review-bot comment workflow

This applies to pull requests in the `Rokurolize/wikijump` fork only. Upstream has no equivalent workflow.

When a PR receives CodeRabbit review comments, use this repository to keep a small, deterministic fix loop:

- Read the GitHub PR comments and keep a list of actionable findings.
- Apply only fixes required by the review item; avoid broad refactors.
- Keep each fix in a focused commit tied to the review item so the result can be re-run quickly.
- Update any impacted tests only when behavior changed.
- Run the minimal validation command for docs-only or code-only changes, and record the exact command and outcome.

Recommended convention for reviewer-facing follow-up: store a short note in the PR with:

1. review item handled,
2. file(s) changed,
3. validation run,
4. unresolved/invalid findings and rationale.
