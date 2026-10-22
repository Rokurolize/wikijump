#!/usr/bin/env node
// Prints the campaign completion result as one JSON object for the evidence
// inventory builder. Exit status mirrors the checker: 0 only for `pass`.
import path from 'node:path';
import {checkCampaignCompletion} from '../src/campaign-completion.mjs';

const option = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a path`);
  return value;
};

try {
  const args = process.argv.slice(2);
  const root = option(args, '--root');
  if (!root) throw new Error('--root is required');
  const result = checkCampaignCompletion(path.resolve(root), {
    sigma9RunContract: option(args, '--sigma9-run-contract'),
    sigma10RunContract: option(args, '--sigma10-run-contract')
  });
  console.log(JSON.stringify({status: result.status, failures: result.failures ?? []}));
  process.exitCode = result.status === 'pass' ? 0 : 1;
} catch (error) {
  console.log(JSON.stringify({status: 'error', failures: [error.message]}));
  process.exitCode = 1;
}
