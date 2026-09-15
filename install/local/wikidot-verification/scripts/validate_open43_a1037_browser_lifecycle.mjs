import fs from "node:fs/promises";

import { verifyOpen43A1037BrowserLifecycleReceipt } from "../src/open43-a1037-browser-lifecycle-contract.mjs";

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || index + 1 >= argv.length) throw new Error(`invalid argument: ${key}`);
    values[key.slice(2)] = argv[++index];
  }
  for (const key of ["receipt", "run-id", "page-slug", "output"]) {
    if (typeof values[key] !== "string" || values[key].length === 0) throw new Error(`missing --${key}`);
  }
  return values;
}

const args = parseArgs(process.argv.slice(2));
const receipt = JSON.parse(await fs.readFile(args.receipt, "utf8"));
const result = verifyOpen43A1037BrowserLifecycleReceipt(receipt, { runId: args["run-id"], pageSlug: args["page-slug"] });
const verdict = {
  schema: "wikijump.open43_a1037_browser_lifecycle_verdict.v1",
  run_id: args["run-id"],
  page_slug: args["page-slug"],
  ...result,
};
await fs.writeFile(args.output, `${JSON.stringify(verdict, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
process.stdout.write(`${JSON.stringify({ status: "pass", output: args.output })}\n`);
