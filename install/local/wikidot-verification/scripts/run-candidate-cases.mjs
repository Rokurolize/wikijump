#!/usr/bin/env node

import { candidateCaseMain } from "../src/candidate-case-command.mjs";

candidateCaseMain().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
