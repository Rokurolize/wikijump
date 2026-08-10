#!/usr/bin/env node

import { candidateAccountProvisioningMain } from "../src/candidate-account-provisioning.mjs";

candidateAccountProvisioningMain().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
