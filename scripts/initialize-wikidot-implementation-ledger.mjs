#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WIKIDOT_IMPLEMENTATION_LEDGER_SCHEMA,
  WIKIDOT_PROPERTY_AXES,
  validateWikidotImplementationLedger,
} from "./lib/wikidot-implementation-ledger.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const catalogPath = resolve(
  repositoryRoot,
  "docs/wikidot-specifications/catalog.json",
);
const ledgerPath = resolve(
  scriptDirectory,
  "data/wikidot-implementation-ledger.json",
);
const liveObservationsPath = resolve(
  scriptDirectory,
  "data/wikidot-live-observations.json",
);
const checkOnly = process.argv.includes("--check");

function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const rawCatalog = readFileSync(catalogPath, "utf8");
const catalog = JSON.parse(rawCatalog);
const liveObservations = JSON.parse(
  readFileSync(liveObservationsPath, "utf8"),
);
const liveObservationIds = liveObservations.observations.map(
  (observation) => observation.id,
);

function validate(ledger) {
  validateWikidotImplementationLedger({
    ledger,
    rawCatalog,
    catalog,
    liveObservationIds,
    repositoryRoot,
  });
}

if (checkOnly) {
  validate(JSON.parse(readFileSync(ledgerPath, "utf8")));
  console.log(
    `Validated ${catalog.feature_count} implementation ledger entries.`,
  );
  process.exit(0);
}

invariant(
  !existsSync(ledgerPath),
  "Implementation ledger already exists; edit it in place and use --check",
);

const features = {};
for (const feature of catalog.features) {
  features[feature.id] = {
    status: feature.id === "module-listpages" ? "in_progress" : "pending",
    confirmed_public_seams: [],
    tests: [],
    implementation_files: [],
    documentation_evidence: [feature.specification],
    live_oracle_evidence: [],
    unresolved_ambiguities_or_blockers: [],
  };
}

features["module-listpages"] = {
  status: "in_progress",
  confirmed_public_seams: [],
  tests: [
    {
      path: "deepwell/tests/list_pages.rs",
      scope:
        "public ListPages and CountPages endpoint/render integration tests",
    },
    {
      path: "deepwell/tests/page.rs",
      scope:
        "public saved-page, preview, URL, pagination, query, permission, and rendering integration tests",
    },
    {
      path: "framerail/tests/list-pages-feed.test.ts",
      scope: "public feed-route parsing and RSS response behavior",
    },
    {
      path: "install/local/wikidot-verification/tests",
      scope:
        "corpus inventory, generated matrix, live differential, regression accounting, RSS, and navigation verifier tests",
    },
  ],
  implementation_files: [
    "deepwell/src/services/page_query",
    "deepwell/src/services/render/list_pages",
    "deepwell/src/services/render/url_arguments.rs",
    "deepwell/src/services/view/module_arguments.rs",
    "deepwell/src/services/view/module_render.rs",
    "framerail/src/lib/server/list-pages-feed.ts",
    "framerail/src/routes/feed",
    "install/local/wikidot-verification",
  ],
  documentation_evidence: [
    "docs/wikidot-specifications/specifications/module/module-listpages.md",
    "docs/wikidot-specifications/live-observations.json",
    "install/local/wikidot-verification/artifacts/listpages-campaign-inventory/documentation-inventory.json",
    "install/local/wikidot-verification/artifacts/listpages-campaign-inventory/corpus-listpages-invocations.jsonl",
    "install/local/wikidot-verification/artifacts/listpages-campaign-inventory/corpus-listpages-clusters.json",
  ],
  live_oracle_evidence: [
    "install/local/wikidot-verification/artifacts/listpages-campaign-live-fixture-classification.json",
    "install/local/wikidot-verification/artifacts/listpages-campaign-generated-preview-reconciliation.json",
    "install/local/wikidot-verification/artifacts/listpages-campaign-feed-endpoint-live.jsonl",
    "install/local/wikidot-verification/artifacts/listpages-campaign-rss-live-preview.jsonl",
    "install/local/wikidot-verification/artifacts/listpages-campaign-rss-selector-live-preview.jsonl",
    "install/local/wikidot-verification/artifacts/listpages-campaign-hash-magic-reconciliation.json",
  ],
  unresolved_ambiguities_or_blockers: [
    "The proposed public TDD seam map has been presented but is awaiting explicit user confirmation before any new tests are added.",
    "Navigation coverage currently reports six exact or browser-local gaps: lpnav-0011-p-2-tag-alpha, lpnav-0013-category-fragment-p-2, lpnav-0016-page2-limit-1-page3-limit-2, lpnav-0017-q-1, lpnav-0018-p-2-q-1, and lpnav-0019-p-2-fragment.",
    "The controlled sandbox could not produce nonzero rating/vote state because RateAction returned not_ok; the exact environment blocker is preserved in the live fixture classification.",
  ],
};

features["module-rate"].tests = [
  {
    path: "framerail/tests/wikidot-legacy-actions.test.js",
    name: "initialized Rate stars preserve the live hidden score value",
    scope:
      "public Framerail Rate widget sidecar regression for the initialized hidden score value",
  },
];
features["module-rate"].implementation_files = [
  "framerail/src/lib/wikidot/wikidot-legacy-actions.js",
];

const ledger = {
  schema: WIKIDOT_IMPLEMENTATION_LEDGER_SCHEMA,
  updated_at: "2026-07-28",
  catalog_sha256: sha256(rawCatalog),
  campaign: {
    name: "ListPages compatibility campaign",
    requested_scope: ["module-listpages"],
    note: "All catalog entries remain represented as required by IMPLEMENTATION_PROMPT.md. This worktree is completing the user-requested ListPages item; unrelated catalog entries remain pending rather than being falsely marked complete.",
  },
  property_axes: WIKIDOT_PROPERTY_AXES,
  feature_property_matrix: {
    "module-listpages": Object.fromEntries(
      Object.keys(WIKIDOT_PROPERTY_AXES).map((axis) => [
        axis,
        {
          status: "unobserved",
          evidence: [],
          observation_gaps: [
            `The ${axis} property has not yet been classified against live Wikidot.`,
          ],
        },
      ]),
    ),
  },
  features,
};

validate(ledger);
mkdirSync(dirname(ledgerPath), { recursive: true });
writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
console.log(
  `Initialized ${catalog.feature_count} implementation ledger entries.`,
);
