# Attribution: wiki-derived theme material and replay assets

This directory is the Theme Lab working area. Its tooling code (`src/`, `scripts/`, `tests/`) is part of Wikijump and is covered by the project's GNU Affero General Public License 3.0. The theme material and captured assets described below are not project code and are not covered by that license.

## Theme ports and publication sources

The theme candidate sources under `ports/` (41 theme ports) and the page sources under `publication/` are adaptations of theme and component pages published on the SCP Foundation wiki (scp-wiki, https://scp-wiki.wikidot.com) and the SCP-JP wiki (scp-jp, https://scp-jp.wikidot.com). Each port directory keeps its upstream source next to the adapted candidate (for example `upstream-en.wikidot.txt`, `candidate-source.css`, `candidate.wikidot.txt`), and `publication/` holds the page sources prepared for the SCP-JP manual publication set (see `publication/FINAL-PUBLICATION.md`).

That wiki content is © its respective authors in the SCP Foundation wiki and SCP-JP wiki communities and is licensed under the Creative Commons Attribution-ShareAlike 3.0 Unported license (CC BY-SA 3.0): https://creativecommons.org/licenses/by-sa/3.0/ — the full license text is in [`LICENSES/CC-BY-SA-3.0.txt`](../../../LICENSES/CC-BY-SA-3.0.txt) at the repository root.

Adaptations were made: the candidates localize the originals (including Japanese localization for SCP-JP), retarget styles to the Japanese credit-module markup, and restructure some payloads (for example moving oversized CSS into page attachments where the wiki page-source size limit required it). The adapted material remains available under CC BY-SA 3.0 on the same terms.

## Replay assets and fonts

`ports/shared-replay-assets/` holds content-addressed assets captured from the themes' live rendering (the manifest is `ports/shared-replay-assets.json`). Captured theme assets (CSS, images) are part of the wiki theme material covered by the CC BY-SA 3.0 declaration above. The directory also holds 790 font files (TTF, OTF, WOFF, WOFF2), identified from the name tables embedded in the files themselves (scan of 2026-11-10):

* 762 font files, spanning 71 family names as recorded in the files' name tables, embed the SIL Open Font License 1.1 in their license metadata. These fonts are licensed under the SIL Open Font License, Version 1.1: the full text is in [`LICENSES/OFL-1.1.txt`](../../../LICENSES/OFL-1.1.txt) at the repository root. The largest groups are Song Myung (180 files), the Sofia Sans family (184 files), the Fira Code family (72 files), IBM Plex Sans (36 files), and Inter (36 files).
* The remaining 28 font files carry no embedded license text. They are third-party fonts whose license could not be confirmed from the files, and they are not covered by the OFL declaration above or by the project license. The copyright notice recorded inside each file is:

| Family (as recorded) | Files | Copyright notice recorded in the file |
| --- | ---: | --- |
| Anonymous Pro | 8 | Copyright (c) Mark Simonson 2009-2010. All rights reserved. |
| Recursive | 7 | Copyright 2019 The Recursive Project Authors (github.com/arrowtype/recursive) |
| Ubuntu | 6 | Copyright 2011 Canonical Ltd. Licensed under the Ubuntu Font Licence 1.0 (as stated in the file) |
| FontAwesome | 3 | Copyright Dave Gandy 2015. All rights reserved. (the file records the license URL http://fontawesome.io/license/) |
| ELAND Nice | 1 | Copyright (c) Eland Retail. All Rights Reserved. |
| Bauhaus LT Demi | 1 | Copyright (c) 1989 Adobe Systems Incorporated. All Rights Reserved. |
| Permanent Marker | 1 | Copyright (c) 2010 by Font Diner, Inc. All rights reserved. (the file records the license URL http://www.apache.org/licenses/LICENSE-2.0) |
| Sans Normalcy | 1 | Copyright (c) 2022, SYwaves |
