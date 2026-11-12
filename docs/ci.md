# Continuous Integration (CI)

We use [GitHub Actions](https://docs.github.com/en/actions) for repository status signals, image build/publish workflows, and deployment automation. See the [`.github/workflows`](https://github.com/Rokurolize/wikijump/tree/develop/.github/workflows) directory for the current jobs.

GitHub Actions runs targeted validation on every pull request. The `pr-checks.yml` workflow maps each changed path to the checks for the area it touches: Deepwell formatting, library tests and Clippy for `deepwell/**`, WWS tests and formatting for `wws/**`, Framerail lint and unit tests for `framerail/**`, the verification package suite for `install/local/wikidot-verification/**`, the standing tooling tests for `install/standing/**`, the workflow policy tests for `.github/**` and `scripts/**`, and a formatting check for `locales/**`. The full `scripts/preflight.sh --final` barrier runs nightly and on manual dispatch as an informational signal; nothing gates a merge on it.

Browser, compatibility, retained-evidence, candidate, and standing validation all run in the maintained local WSL workspace. In particular, compatibility acquisition remains local so persistent identity-bound response caches survive retries and a repeated cache hit causes zero external requests.
