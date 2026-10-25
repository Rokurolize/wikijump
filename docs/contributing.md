# Contributing

This document assumes you have read [Development.md](development.md).

This file covers two separate processes. Read only the one that applies to where your change is going.

## Fork: Rokurolize/wikijump

Wikijump has a broad Wikidot compatibility surface and many areas for people to contribute. Contributions should close an observed compatibility gap, improve live-oracle evidence or regression coverage, correct a defect, or improve security and maintainability without changing evidenced behavior. Independent product features and compatibility-breaking UX, route, or DOM redesigns are outside this fork's compatibility work.

Work is tracked in this fork's GitHub issues. See [issue-tracker.md](agents/issue-tracker.md).

Fork changes are merged with a normal two-parent PR merge into this fork's `develop`, as described in [CLAUDE.md](../CLAUDE.md). Promotion to the standing runtime follows [runtime-drift-policy.md](deployment/runtime-drift-policy.md).

Review-bot comments on fork PRs are handled as described in [review-comment-workflow.md](agents/review-comment-workflow.md).

## Upstream: scpwiki/wikijump

The rules in this section apply to contributions to the upstream project, not to this fork.

It is important that you join the Wikijump Discord so you can discuss and coordinate with the Wikijump team.  You can get an invitation by asking in [#site11](https://scp-wiki.wikidot.com/chat-guide). If appropriate, a team member can make a [JIRA](https://scuttle.atlassian.net/browse/WJ) issue for the work.

Once you've implemented the changes, create an upstream PR and request reviews from 1-3 relevant people. See [CODEOWNERS](https://github.com/scpwiki/wikijump/blob/develop/CODEOWNERS) to get an idea of who works on which parts of the repository. It'll be reviewed and merged if ready.

Upstream changes are merged against `develop`, which automatically deploys to `wikijump.dev`. In longer cycles, we take accrued changes in `develop` and produce a squash commit to `prod`, which deploys to `wikijump.com` (the production environment). This way can utilize continuous deployment for development but also keep production stable. (See [CI.md](ci.md) for more information)
