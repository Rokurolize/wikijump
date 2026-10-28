// Firefox-engine invocation of the Wikidot adaptation A/B for the flopstyle
// Firefox-only certified block (the stock CLI fixes the Chromium engine).
import fs from 'node:fs';
import {runAdaptationAB} from '/home/roku/.local/state/wikijump/agents/wt-fixbatch/install/local/theme-lab/scripts/wikidot-adaptation-ab.mjs';
const result = await runAdaptationAB({
  url: 'https://scp-jp.wikidot.com/scp-173-jp',
  outputDir: '/home/roku/.local/state/wikijump/agents/wt-fixbatch/install/local/theme-lab/ports/authority-evidence/flopstyle-dark-navigation-action-recert-20261028',
  cacheDir: '/home/roku/.local/state/wikijump/theme-lab/ab-cache',
  acquire: true,
  css: fs.readFileSync('/home/roku/.local/state/wikijump/agents/wt-fixbatch/install/local/theme-lab/ports/flopstyle-dark/candidate.css', 'utf8'),
  removeBlock: 'SCP-JP Wikidot Flopstyle Dark Firefox submenu: anchor the third parent endpoint at mobile widths.',
  state: 'navigation-action',
  widths: [320, 390],
  browserEngine: 'firefox',
  executablePath: '/home/roku/.cache/ms-playwright/firefox-1543/firefox/firefox',
});
console.log(JSON.stringify({rows: result.rows.length, with_pass: result.rows.filter(r => r.variant === 'with').every(r => r.pass), without_pass: result.rows.filter(r => r.variant === 'without').every(r => r.pass), engine: result.browser_engine}));
