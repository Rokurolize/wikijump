# Continuous Integration (CI)

We use [GitHub Actions](https://docs.github.com/en/actions) for repository status signals, image build/publish workflows, and deployment automation. See the [`.github/workflows`](https://github.com/scpwiki/wikijump/tree/develop/.github/workflows) directory for the current jobs.

GitHub Actions intentionally runs no validation tests. Unit, integration, browser, compatibility, retained-evidence, candidate, and standing validation all run in the maintained local WSL workspace. In particular, compatibility acquisition remains local so persistent identity-bound response caches survive retries and a repeated cache hit causes zero external requests.
