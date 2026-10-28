// History-list invocation of the Wikidot adaptation A/B for the turbo-vision
// certified history block (the stock CLI cannot pass the frozen native
// history bindings the state requires). Bindings reuse the originally
// certified native responses for scp-173 (page 19439882), read from the
// campaign runtime evidence tree; the run itself re-acquires the page shell
// through the shared reference cache and writes fresh native-history files
// into the output directory.
import fs from 'node:fs';
import {runAdaptationAB} from '/home/roku/.local/state/wikijump/agents/wt-fixbatch/install/local/theme-lab/scripts/wikidot-adaptation-ab.mjs';
const SRC = '/home/roku/.local/state/wikijump/theme-lab/runtime-source-campaign-20261023/install/local/theme-lab/ports/authority-evidence/turbo-vision-final-three-authority-16-history-list-v3-20261002';
const result = await runAdaptationAB({
  url: 'https://scp-jp.wikidot.com/scp-173',
  outputDir: '/home/roku/.local/state/wikijump/agents/wt-fixbatch/install/local/theme-lab/ports/authority-evidence/turbo-vision-recert-20261028-history-list',
  cacheDir: '/home/roku/.local/state/wikijump/theme-lab/ab-cache',
  acquire: true,
  css: fs.readFileSync('/home/roku/.local/state/wikijump/agents/wt-fixbatch/install/local/theme-lab/ports/turbo-vision/candidate.css', 'utf8'),
  removeBlock: 'SCP-JP Wikidot native history list: preserve the seven columns inside their own horizontal scroller.',
  state: 'history-list',
  selectors: ['#revision-list'],
  widths: [320, 390, 1440],
  frozenHistory: {
    pageHistory: {receipt: SRC + '/native-history-acquisition-0.json', response: SRC + '/native-history-response-0.json', requestId: 'jp-01'},
    revisionList: {receipt: SRC + '/native-history-acquisition-1.json', response: SRC + '/native-history-response-1.json', requestId: 'jp-02'},
  },
});
console.log(JSON.stringify({rows: result.rows.length, with_pass: result.rows.filter(r => r.variant === 'with').every(r => r.pass), without_pass: result.rows.filter(r => r.variant === 'without').every(r => r.pass)}));
