#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateOpen43ConcurrencyLedger } from "../src/open43-concurrency-ledger.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../../../..");
const ledgerPath = path.resolve(
  process.argv[2] ??
    path.join(
      repositoryRoot,
      "docs/development/open43-concurrency-ledger.json",
    ),
);

const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
validateOpen43ConcurrencyLedger(ledger);
console.log(`Validated ${ledger.lanes.length} Open43 lanes.`);
