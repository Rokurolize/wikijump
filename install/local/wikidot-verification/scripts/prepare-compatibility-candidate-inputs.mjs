#!/usr/bin/env node

import { prepareCompatibilityCandidateInputsMain } from "../src/compatibility-candidate-input-producer.mjs";

prepareCompatibilityCandidateInputsMain().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
