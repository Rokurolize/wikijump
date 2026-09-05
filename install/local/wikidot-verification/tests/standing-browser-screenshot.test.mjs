import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { capturePng } from "../src/standing-browser-screenshot.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

test("CDP screenshot capture preserves immediate viewport and settled full-page modes", async (context) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "standing-browser-screenshot-"),
  );
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const calls = [];
  const client = {
    async send(method, options) {
      calls.push({ method, options });
      if (method === "Page.getLayoutMetrics") {
        return { cssContentSize: { width: 100, height: 200 } };
      }
      return { data: Buffer.from("png").toString("base64") };
    },
    async detach() {
      calls.push({ method: "detach" });
    },
  };
  const page = { context: () => ({ newCDPSession: async () => client }) };
  const viewport = path.join(directory, "viewport.png");
  const full = path.join(directory, "full.png");
  await capturePng(page, viewport);
  await capturePng(page, full, { fullPage: true });
  assert.equal((await fs.readFile(viewport)).toString(), "png");
  assert.equal((await fs.readFile(full)).toString(), "png");
  assert.deepEqual(
    calls
      .filter((call) => call.method === "Page.captureScreenshot")
      .map((call) => call.options.captureBeyondViewport),
    [false, true],
  );
});

test("successful CDP detach does not keep the process alive for the detach timeout", async () => {
  const childSource = String.raw`
    import os from "node:os";
    import path from "node:path";
    import { capturePng } from "./install/local/wikidot-verification/src/standing-browser-screenshot.mjs";

    const client = {
      async send() {
        return {data: Buffer.from("png").toString("base64")};
      },
      async detach() {},
    };
    const page = {context: () => ({newCDPSession: async () => client})};
    await capturePng(page, path.join(os.tmpdir(), "standing-browser-screenshot-child.png"));
    console.log("done");
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", childSource], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const exit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({code, signal}));
  });
  let timer = null;
  try {
    const result = await Promise.race([
      exit,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("successful screenshot detach retained its timeout handle")), 1_000);
      }),
    ]);
    assert.deepEqual(result, {code: 0, signal: null}, stderr);
    assert.equal(stdout.trim(), "done");
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exit;
  }
});
