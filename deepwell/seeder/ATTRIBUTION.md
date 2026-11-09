# Attribution: wiki-derived seed content

The seeder loads the files listed in its JSON manifests (`pages.json`, `files.json`, and the related manifests) into every new site it creates, so the files in this directory are redistributed with each seeded site. Most seed files (the platform pages, manifests, and configuration) were written for Wikijump and are covered by the project's GNU Affero General Public License 3.0. The subset listed below derives from pages of the SCP Foundation wiki (scp-wiki, https://scp-wiki.wikidot.com); it is © its respective authors in the SCP Foundation wiki community and is licensed under the Creative Commons Attribution-ShareAlike 3.0 Unported license (CC BY-SA 3.0): https://creativecommons.org/licenses/by-sa/3.0/ — the full license text is in [`LICENSES/CC-BY-SA-3.0.txt`](../../LICENSES/CC-BY-SA-3.0.txt) at the repository root. The project AGPL license does not apply to the files listed below.

Adaptations were made where the seeding format required them (include retargeting and parameter localization); the adapted material remains available under CC BY-SA 3.0 on the same terms.

## Components

| File | Source | Basis in the file itself |
| --- | --- | --- |
| `component-acs-animation.ftml` | SCP Wiki, `component:acs-animation` | The file documents the `[[include :scp-wiki:component:acs-animation]]` form |
| `component-betterfootnotes.ftml` | SCP Wiki component | The file states it mimics the custom footnotes seen in SCP-4485 and loads the Black Highlighter theme CSS |
| `component-image-block.ftml`, `component-image-block-base.ftml` | SCP Wiki, `component:image-block` / `component:image-block-base` | `component-image-block.ftml` wraps `[[include :scp-wiki:component:image-block-base ...]]` |
| `component-interwiki-style.ftml` | SCP Wiki interwiki project | The file header cites https://scpwiki.com/interwiki and https://github.com/scpwiki/interwiki as its source |
| `component-license-box.ftml`, `component-license-box-end.ftml`, `component-license-box-backend.ftml` | SCP Wiki, `component:license-box` family | `component-license-box.ftml` documents the `:scp-wiki:component:license-box` include; the backend's template attributes wiki pages to the SCP Wiki under CC BY-SA |
| `component-preview.ftml` | SCP Wiki component | The file documents the `component:preview` include and the Crom thumbnail feature used on the SCP Wiki |
| `component-wikimodule.ftml` | SCP Wiki author-page module | The file's own text is the component author's documentation for use at the bottom of SCP Wiki articles |

## Article and theme copies, fragments, and attachments

| File | Source |
| --- | --- |
| `scp-002.ftml`, `scp-3352.ftml`, `scp-3922.ftml`, `scp-8980.ftml`, `scp-9506.ftml` | Seeded copies of the SCP Wiki articles of the same names |
| `fragment-scp-8980-1.ftml`, `fragment-scp-8980-2.ftml` | The SCP-8980 fragment pages; `scp-8980.ftml` records their source URLs (https://scp-wiki.wikidot.com/fragment:scp-8980-1 and https://scp-wiki.wikidot.com/fragment:scp-8980-2) |
| `theme-basalt.ftml` | Seeded copy of the SCP Wiki Basalt theme page (`theme:basalt`); the file loads the theme through `:scp-wiki:` interwiki-style includes from cdn.scpwiki.com |
| `scp-002--800px-SCP002-new.jpg`, `scp-3352--steel.png`, `scp-3352--steel1.png`, `scp-3352--steel2.png`, `scp-3352--steel3.png`, `scp-5382--thaumiel-icon-2.svg`, `scp-7000--inimical-icon.svg`, `component-anomaly-class-bar--amida-icon.svg`, `component-anomaly-class-bar--critical-icon.svg`, `component-anomaly-class-bar--danger-icon.svg`, `component-anomaly-class-bar--ekhi-icon.svg`, `component-anomaly-class-bar--keter-icon.svg`, `the-b-b-decommission--Asterisk43.png`, `this-page-intentionally-left-blank--Mallet.png`, `theme-blankstyle--43Head.png` | File attachments copied from the corresponding SCP Wiki pages, following the seeder's `<page>--<filename>` naming convention |
