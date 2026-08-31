#!/usr/bin/env node

import {execFile as execFileCallback} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";

import {validateCandidateParityIdentity} from "../src/standing-browser-parity-receipt.mjs";
import {runCliIfMain} from "../src/cli-entry.mjs";

const execFile = promisify(execFileCallback);

export async function main(argv, {stdout = console.log} = {}) {
  if (argv.length !== 4 || argv[0] !== "--candidate-root" || argv[2] !== "--private-runtime") throw new Error("usage: stop-promotion-candidate.mjs --candidate-root DIR --private-runtime FILE");
  const root = path.resolve(argv[1]);
  const privateRuntime = JSON.parse(await fs.readFile(path.resolve(argv[3]), "utf8"));
  const identity = validateCandidateParityIdentity(JSON.parse(await fs.readFile(path.join(root, "candidate-identity.json"), "utf8")));
  await execFile("/usr/bin/docker", ["compose", "-p", identity.candidate.compose_project, "-f", path.join(root, "compose.json"), "down", "--volumes", "--remove-orphans"], {
    env: {...process.env, DEEPWELL_RPC_TOKEN: privateRuntime.deepwell_rpc_token},
    maxBuffer: 64 * 1024 * 1024,
  });
  stdout(JSON.stringify({status: "pass", project: identity.candidate.compose_project, resources_released: true}));
  return 0;
}

await runCliIfMain(import.meta.url, main, {onError: (error) => { console.error(error?.stack ?? String(error)); return 1; }});
