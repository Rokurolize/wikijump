import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  pidPathFor,
  prepareSocketForStart,
  processAlive,
  readPidFile,
  socketState,
  stopDaemon,
  writePidFile,
} from "../src/daemon.mjs";
import {ThemeLabError} from "../src/errors.mjs";

async function tempSocket() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "theme-lab-daemon-"));
  return {dir, socketPath: path.join(dir, "session.sock")};
}

test("socketState reports absent, stale, and live", async (t) => {
  const {dir, socketPath} = await tempSocket();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));

  assert.equal(await socketState(socketPath), "absent");

  await fs.writeFile(socketPath, "");
  assert.equal(await socketState(socketPath), "stale");

  const server = net.createServer();
  await fs.rm(socketPath, {force: true});
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  assert.equal(await socketState(socketPath), "live");
});

test("prepareSocketForStart clears a stale socket but refuses a live one", async (t) => {
  const {dir, socketPath} = await tempSocket();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));

  await fs.writeFile(socketPath, "");
  assert.equal(await prepareSocketForStart(socketPath), "stale");
  assert.equal(await socketState(socketPath), "absent");

  const server = net.createServer();
  await new Promise((resolve) => server.listen(socketPath, resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await assert.rejects(
    () => prepareSocketForStart(socketPath),
    (error) => error instanceof ThemeLabError && error.code === "socket_in_use",
  );
});

test("pid file round-trips and processAlive is truthful", async (t) => {
  const {dir, socketPath} = await tempSocket();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));

  assert.equal(await readPidFile(socketPath), null);
  await writePidFile(socketPath, process.pid);
  assert.equal(await readPidFile(socketPath), process.pid);
  assert.equal(processAlive(process.pid), true);
  assert.equal(processAlive(2 ** 31 - 1), false);
  assert.equal(path.basename(pidPathFor(socketPath)), "session.sock.pid");
});

test("stopDaemon cleans a stale socket and pid file", async (t) => {
  const {dir, socketPath} = await tempSocket();
  t.after(() => fs.rm(dir, {recursive: true, force: true}));

  await fs.writeFile(socketPath, "");
  await writePidFile(socketPath, 2 ** 31 - 1);
  const result = await stopDaemon(socketPath, {timeoutMs: 200});
  assert.equal(result.stopped, true);
  assert.equal(await socketState(socketPath), "absent");
  assert.equal(await readPidFile(socketPath), null);
});
