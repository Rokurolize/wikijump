# Attribution: frozen observations captured from live Wikidot pages

The tooling in this directory (`src/`, `scripts/`, `tests/`) is part of Wikijump and is covered by the project's GNU Affero General Public License 3.0. The captured data described below is not project code and is not covered by that license.

The files under `artifacts/` (137 JSON captures) and the evidence records under `fixtures/` are frozen observations measured from live pages on Wikidot — principally the SCP Foundation wiki (scp-wiki, https://scp-wiki.wikidot.com) and the SCP-JP wiki (scp-jp, https://scp-jp.wikidot.com). They record rendered output and page data exactly as the live sites served it, and the verification suite consumes them as expected-behavior evidence instead of re-fetching the live sites.

The underlying page content is © its respective authors in the SCP Foundation wiki and SCP-JP wiki communities and is licensed under the Creative Commons Attribution-ShareAlike 3.0 Unported license (CC BY-SA 3.0): https://creativecommons.org/licenses/by-sa/3.0/ — the full license text is in [`LICENSES/CC-BY-SA-3.0.txt`](../../../LICENSES/CC-BY-SA-3.0.txt) at the repository root.
