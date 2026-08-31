import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_GLOBAL_LOCK_PATH = path.join(os.tmpdir(), "wikijump-candidate-run.lock");

async function releaseOwnedLease(lockPath, ownership, payload) {
  let current;
  try {
    current = await fs.lstat(lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("candidate global lease disappeared before release");
    throw error;
  }
  if (current.dev !== ownership.dev || current.ino !== ownership.ino || await fs.readFile(lockPath, "utf8") !== payload) {
    throw new Error("candidate global lease ownership changed before release");
  }
  await fs.unlink(lockPath);
}

export async function withCandidateGlobalLease({runId, evidenceDirectory, lockPath = DEFAULT_GLOBAL_LOCK_PATH}, operation) {
  const resolvedLockPath = path.resolve(lockPath);
  const lock = await fs.open(resolvedLockPath, "wx", 0o600);
  const ownership = await lock.stat();
  const payload = `${JSON.stringify({
    schema: "wikijump.candidate_global_lock.v1",
    run_id: runId,
    evidence_directory: path.resolve(evidenceDirectory),
    lease_id: randomBytes(16).toString("hex"),
  })}\n`;
  let closed = false;
  try {
    await lock.writeFile(payload);
    await lock.sync();
    await lock.close();
    closed = true;
    return await operation();
  } finally {
    if (!closed) await lock.close().catch(() => {});
    await releaseOwnedLease(resolvedLockPath, ownership, payload);
  }
}
