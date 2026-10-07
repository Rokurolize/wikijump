#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkCampaignCompletion} from '../src/campaign-completion.mjs';
try {
  const result = checkCampaignCompletion(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  console.log(JSON.stringify({command: 'current-campaign-completion', result: result.status === 'pass' ? 'CURRENT CAMPAIGN ACCEPTED' : 'CURRENT CAMPAIGN NOT ACCEPTED', overall_acceptance: {status: result.status}, ...result}, null, 2));
  process.exitCode = result.status === 'pass' ? 0 : result.status === 'inconclusive' ? 2 : 1;
} catch (error) {
  console.log(JSON.stringify({command: 'current-campaign-completion', result: 'CURRENT CAMPAIGN NOT ACCEPTED', overall_acceptance: {status: 'fail'}, failures: [error.message]}, null, 2));
  process.exitCode = 1;
}
