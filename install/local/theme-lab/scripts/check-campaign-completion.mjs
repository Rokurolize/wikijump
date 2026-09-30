#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkCampaignCompletion} from '../src/campaign-completion.mjs';
const result = checkCampaignCompletion(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
console.log(JSON.stringify({result: result.status === 'pass' ? 'CURRENT CAMPAIGN ACCEPTED' : 'CURRENT CAMPAIGN NOT ACCEPTED', overall_acceptance: {status: result.status}, ...result}, null, 2));
process.exitCode = result.status === 'pass' ? 0 : result.status === 'inconclusive' ? 2 : 1;
