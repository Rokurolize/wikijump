import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const GLOBAL_LOCK_NAME = "wikijump-candidate-run.lock";

export async function withCandidateGlobalLease({runId, evidenceDirectory}, operation) {
  const lockPath = path.join(os.tmpdir(), GLOBAL_LOCK_NAME);
  const lock = await fs.open(lockPath, "wx", 0o600);
  let closed = false;
  try {
    await lock.writeFile(`${JSON.stringify({schema: "wikijump.candidate_global_lock.v1", run_id: runId, evidence_directory: path.resolve(evidenceDirectory)})}\n`);
    await lock.sync();
    await lock.close();
    closed = true;
    return await operation();
  } finally {
    if (!closed) await lock.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
  }
}
