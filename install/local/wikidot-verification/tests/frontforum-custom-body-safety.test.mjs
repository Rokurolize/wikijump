import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = new URL("../", import.meta.url);
const script = new URL("scripts/capture-frontforum-custom-body.mjs", root);
const fixtureUrl = new URL("fixtures/frontforum-custom-body/cases.json", root);

test("FrontForum capture rejects an endpoint outside the sealed public seam before fetching", async () => {
  const fixture = JSON.parse(await fs.readFile(fixtureUrl, "utf8"));
  fixture.endpoint = "http://127.0.0.1:9/ajax-module-connector.php";
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "frontforum-capture-"),
  );
  const casesPath = path.join(directory, "cases.json");
  const outputPath = path.join(directory, "output.json");
  await fs.writeFile(casesPath, JSON.stringify(fixture));
  await assert.rejects(
    run(process.execPath, [
      script.pathname,
      "--cases",
      casesPath,
      "--output",
      outputPath,
    ]),
    /endpoint/u,
  );
  await fs.rm(directory, { recursive: true, force: true });
});
