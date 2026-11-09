# Wikijump

<p align="center">
  <a href="https://codecov.io/gh/Rokurolize/wikijump">
    <img src="https://codecov.io/gh/Rokurolize/wikijump/branch/develop/graph/badge.svg"
         alt="Codecov report for Rokurolize/wikijump develop">
  </a>

  <a href="https://coderabbit.ai">
    <img src="https://img.shields.io/coderabbit/prs/github/Rokurolize/wikijump.svg?label=CodeRabbit%20Reviews"
         alt="CodeRabbit Reviews for Rokurolize/wikijump">
  </a>

  <a href="https://deepwiki.com/Rokurolize/wikijump">
    <img src="https://deepwiki.com/badge.svg?repository=Rokurolize/wikijump"
         alt="Ask DeepWiki about Rokurolize/wikijump">
  </a>

  <a href="https://github.com/Rokurolize/wikijump/actions/workflows/deepwell.yaml?query=branch%3Adevelop">
    <img src="https://github.com/Rokurolize/wikijump/actions/workflows/deepwell.yaml/badge.svg?branch=develop"
         alt="Deepwell CI status on develop">
  </a>

  <a href="https://github.com/Rokurolize/wikijump/actions/workflows/wws.yaml?query=branch%3Adevelop">
    <img src="https://github.com/Rokurolize/wikijump/actions/workflows/wws.yaml/badge.svg?branch=develop"
         alt="WWS CI status on develop">
  </a>

  <a href="https://github.com/Rokurolize/wikijump/actions/workflows/framerail.yaml?query=branch%3Adevelop">
    <img src="https://github.com/Rokurolize/wikijump/actions/workflows/framerail.yaml/badge.svg?branch=develop"
         alt="Framerail CI status on develop">
  </a>

  <a href="https://github.com/Rokurolize/wikijump/actions/workflows/locales.yaml?query=branch%3Adevelop">
    <img src="https://github.com/Rokurolize/wikijump/actions/workflows/locales.yaml/badge.svg?branch=develop"
         alt="Localization CI status on develop">
  </a>
</p>

This repository is Rokurolize's fork of [scpwiki/wikijump](https://github.com/scpwiki/wikijump).
This fork develops Wikijump as a Wikidot-compatible emulator. Its compatibility target is the complete observable behavior of live Wikidot across syntax, storage, APIs, permissions, HTTP routes, DOM and CSS, and browser interactions, including legacy and surprising behavior. When documentation, tests, or local Wikijump output disagree with a controlled live observation, the live behavior is canonical.

Independent product redesigns, compatibility-breaking "improvements," and feature additions without Wikidot evidence are outside this fork's compatibility work. Escaping, sanitization, and other security boundaries remain enforced; any intentional deviation must be explicit and evidence-backed.

Wikijump began as the [SCP Wiki](https://scpwiki.com)'s fork of the unmaintained [Wikidot](https://github.com/gabrys/wikidot).

The upstream project is being primarily developed by the English SCP Wiki's [Technical Team](http://05command.wikidot.com/technical-staff-main) as part of Project Foundation, however other contributors are welcome.
Upstream issues are tracked on [Jira](https://scuttle.atlassian.net/browse/WJ).

Questions and comments for the upstream project can be posted in the [General Information forum](https://scpwiki.com/forum/c-3335628/general-information), or in [`#site11` on SkipIRC](https://scpwiki.com/chat-guide).

## Contributing

Fork-local contributions should close observed compatibility gaps, expand durable Wikidot evidence and regression coverage, or improve security and maintainability without changing evidenced behavior. Changes should be validated in this repository before any upstream submission is prepared.

If you would like to volunteer some of your time to Wikijump development, join the Discord and chat with us! (Invites can be received in `#site11` or by DMing a current Wikijump team member).

### Development

(This section will be rewritten as the Framerail migration continues)

See [development.md](docs/development.md) for information on running a local instance of Wikijump, the [Wikijump Glossary](docs/glossary.md) for terminology used by developers and API consumers, and [contributing.md](docs/contributing.md) if you're interested in contributing to the project.

## Sponsors

Wikijump would like to thank the following organizations for graciously permitting us to use their services for free:

* [Atlassian](https://scuttle.atlassian.net/) ([info](https://www.atlassian.com/software/views/open-source-license-request))
* [JetBrains](https://www.jetbrains.com/phpstorm/) ([info](https://www.jetbrains.com/community/opensource/#support))

## License

Wikijump is available under the same license as Wikidot, the [GNU Affero General Public License 3.0](https://www.gnu.org/licenses/agpl-3.0.en.html) (AGPL 3.0).

```
Wikijump - FOSS Wiki Software for Writing Communities
Copyright (c) 2019-2026, Wikijump Team

Based on Wikidot - free wiki collaboration software
Copyright (c) 2008, Wikidot Inc.
```

## Third-party content

Wikijump's code is AGPL 3.0, but the repository also carries third-party content that keeps its own license terms and is not covered by the project license. The declared areas are:

* Theme ports, publication sources, and replay assets in [`install/local/theme-lab/`](install/local/theme-lab/ATTRIBUTION.md): material adapted from SCP Foundation wiki and SCP-JP wiki theme and component pages, licensed CC BY-SA 3.0; most of the captured font files there are licensed under the SIL Open Font License 1.1, and a small number of fonts whose license could not be confirmed from the files are itemized in the same attribution file.
* Wiki-derived seed content in [`deepwell/seeder/`](deepwell/seeder/ATTRIBUTION.md): components, article and theme copies, fragments, and attachments adapted or copied from SCP Foundation wiki pages, licensed CC BY-SA 3.0, which the seeder redistributes into every new site.
* Frozen live-page observations in [`install/local/wikidot-verification/`](install/local/wikidot-verification/ATTRIBUTION.md): captures of SCP Foundation wiki and SCP-JP wiki page output used as verification evidence, licensed CC BY-SA 3.0.
* Pinned stylesheets in [`framerail/static/wikidot/`](framerail/static/wikidot/ATTRIBUTION.md): byte-pinned copies of the SCP Foundation wiki Sigma theme (CC BY-SA 3.0) and of two Wikidot platform stylesheets, served for rendering compatibility.

The license texts are in [`LICENSES/CC-BY-SA-3.0.txt`](LICENSES/CC-BY-SA-3.0.txt) and [`LICENSES/OFL-1.1.txt`](LICENSES/OFL-1.1.txt). Bulk verbatim wiki content (full page sources) is not stored in this repository; it is managed outside version control.
