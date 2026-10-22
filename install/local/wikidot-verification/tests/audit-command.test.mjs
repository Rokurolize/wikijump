import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {runAuditCommand, withAuditSignals} from "../src/audit-command.mjs";

const NODE = process.execPath;

async function tempDir(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-audit-command-"));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  return root;
}

test("a zero exit resolves with captured output and timing", async () => {
  const result = await runAuditCommand(NODE, ["-e", "console.log('out'); console.error('err');"], {capture: true});
  assert.equal(result.code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "out\n");
  assert.equal(result.stderr, "err\n");
  assert.equal(result.timedOut, false);
  assert.equal(typeof result.elapsed_ms, "number");
  assert.ok(result.elapsed_ms >= 0);
});

test("a non-zero exit rejects with the status unless failure is allowed", async () => {
  await assert.rejects(
    runAuditCommand(NODE, ["-e", "process.exit(3);"], {capture: true}),
    /failed with status 3/u,
  );
  const allowed = await runAuditCommand(NODE, ["-e", "process.exit(3);"], {capture: true, allowFailure: true});
  assert.equal(allowed.code, 3);
  assert.equal(allowed.timedOut, false);
});

test("a failing command reports its captured stderr in the rejection", async () => {
  await assert.rejects(
    runAuditCommand(NODE, ["-e", "console.error('boom-detail'); process.exit(1);"], {capture: true}),
    /boom-detail/u,
  );
});

test("a signal death rejects with the signal name", async () => {
  await assert.rejects(
    runAuditCommand(NODE, ["-e", "process.kill(process.pid, 'SIGTERM');"], {capture: true}),
    /failed with signal SIGTERM/u,
  );
});

test("an unspawnable command rejects instead of hanging", async () => {
  await assert.rejects(
    runAuditCommand("wj-definitely-not-a-command-1990", [], {capture: true}),
    /ENOENT/u,
  );
});

test("a pre-aborted signal rejects before spawning", async (t) => {
  const root = await tempDir(t);
  const marker = path.join(root, "spawned");
  const controller = new AbortController();
  controller.abort(new Error("stop-before-start"));
  await assert.rejects(
    runAuditCommand(
      NODE,
      ["-e", `await import("node:fs/promises").then((fs) => fs.writeFile(${JSON.stringify(marker)}, "x"));`],
      {capture: true, signal: controller.signal},
    ),
    /stop-before-start/u,
  );
  assert.equal(await fs.stat(marker).then(() => true, () => false), false);
});

test("an abort mid-run stops the child and rejects with the reason", async () => {
  const controller = new AbortController();
  const run = runAuditCommand(NODE, ["-e", "setTimeout(() => {}, 30000);"], {
    capture: true,
    signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  controller.abort(new Error("stop-mid-run-1990"));
  await assert.rejects(run, /stop-mid-run-1990/u);
});

test("a timeout terminates a hung child and reports timedOut", async () => {
  const result = await runAuditCommand(NODE, ["-e", "setTimeout(() => {}, 30000);"], {
    capture: true,
    allowFailure: true,
    timeoutMs: 200,
  });
  assert.equal(result.timedOut, true);
  await assert.rejects(
    runAuditCommand(NODE, ["-e", "setTimeout(() => {}, 30000);"], {capture: true, timeoutMs: 200}),
    /failed with/u,
  );
});

test("a log path captures child output exclusively with owner-only mode", async (t) => {
  const root = await tempDir(t);
  const logPath = path.join(root, "audit.log");
  const result = await runAuditCommand(NODE, ["-e", "console.log('logged-out'); console.error('logged-err');"], {
    logPath,
  });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.equal(await fs.readFile(logPath, "utf8"), "logged-out\nlogged-err\n");
  assert.equal((await fs.stat(logPath)).mode & 0o777, 0o600);
  await assert.rejects(runAuditCommand(NODE, ["-e", ""], {logPath}), /EEXIST/u);
});

test("a detached process group still reports a fast exit", async () => {
  const result = await runAuditCommand(NODE, ["-e", "console.log('grouped');"], {capture: true, processGroup: true});
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "grouped\n");
  assert.equal(result.timedOut, false);
});

test("an ignored SIGINT in a process group escalates to SIGTERM within bounds", async () => {
  const start = Date.now();
  const result = await runAuditCommand(NODE, ["-e", "process.on('SIGINT', () => {}); setTimeout(() => {}, 30000);"], {
    capture: true,
    allowFailure: true,
    timeoutMs: 200,
    processGroup: true,
  });
  const elapsed = Date.now() - start;
  assert.equal(result.timedOut, true);
  assert.ok(elapsed >= 900, `SIGTERM escalation fired too early: ${elapsed}ms`);
  assert.ok(elapsed < 5000, `SIGTERM escalation took too long: ${elapsed}ms`);
});

test("a group ignoring SIGTERM escalates to SIGKILL within bounds", async () => {
  const start = Date.now();
  const result = await runAuditCommand(
    NODE,
    ["-e", "process.on('SIGINT', () => {}); process.on('SIGTERM', () => {}); setTimeout(() => {}, 30000);"],
    {capture: true, allowFailure: true, timeoutMs: 200, processGroup: true},
  );
  const elapsed = Date.now() - start;
  assert.equal(result.timedOut, true);
  assert.ok(elapsed >= 1900, `SIGKILL escalation fired too early: ${elapsed}ms`);
  assert.ok(elapsed < 8000, `SIGKILL escalation took too long: ${elapsed}ms`);
});

test("a lingering grandchild is reaped through group SIGTERM", async () => {
  const start = Date.now();
  const result = await runAuditCommand(NODE, ["-e", `
    import {spawn} from "node:child_process";
    const grandchild = spawn(
      ${JSON.stringify(NODE)},
      ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 30000);"],
      {stdio: "ignore"},
    );
    grandchild.unref();
  `], {capture: true, allowFailure: true, processGroup: true});
  const elapsed = Date.now() - start;
  assert.equal(result.code, 0);
  assert.ok(elapsed >= 800, `group reap returned too early: ${elapsed}ms`);
  assert.ok(elapsed < 8000, `group reap took too long: ${elapsed}ms`);
});

test("audit signals reach the callback and listeners are removed after", async () => {
  const beforeInt = process.listenerCount("SIGINT");
  const beforeTerm = process.listenerCount("SIGTERM");
  let seen = null;
  const returned = await withAuditSignals((signal) => {
    seen = signal;
    assert.equal(process.listenerCount("SIGINT"), beforeInt + 1);
    assert.equal(process.listenerCount("SIGTERM"), beforeTerm + 1);
    return "done-1990";
  });
  assert.equal(returned, "done-1990");
  assert.ok(seen instanceof AbortSignal);
  assert.equal(seen.aborted, false);
  assert.equal(process.listenerCount("SIGINT"), beforeInt);
  assert.equal(process.listenerCount("SIGTERM"), beforeTerm);
});
