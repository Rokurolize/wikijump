import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseCandidateCaseArgs,
  readPrivateCandidateCaseInput,
} from "../src/candidate-case-command.mjs";

test("candidate case command accepts only the fixed explicit attachment options", () => {
  assert.deepEqual(
    parseCandidateCaseArgs([
      "--",
      "--case-set",
      "open43-media-files",
      "--candidate-identity",
      "candidate.json",
      "--private-input",
      "private.json",
      "--output-dir",
      "evidence",
    ]),
    {
      "case-set": "open43-media-files",
      "candidate-identity": "candidate.json",
      "private-input": "private.json",
      "output-dir": "evidence",
    },
  );
  assert.throws(
    () => parseCandidateCaseArgs(["--case-set", "open43-media-files"]),
    /missing --candidate-identity/u,
  );
  assert.throws(
    () => parseCandidateCaseArgs(["--plan", "dynamic.json"]),
    /unknown or duplicate option/u,
  );
});

test("private candidate input is hashed from one private non-linked file read", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "candidate-case-private-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "private.json");
  await fs.writeFile(file, '{"secret":"private"}\n', { mode: 0o600 });
  const input = await readPrivateCandidateCaseInput(file);
  assert.deepEqual(input.value, { secret: "private" });
  assert.match(input.sha256, /^[0-9a-f]{64}$/u);

  const publicFile = path.join(root, "public.json");
  await fs.writeFile(publicFile, "{}\n", { mode: 0o644 });
  await assert.rejects(
    readPrivateCandidateCaseInput(publicFile),
    /private regular file/u,
  );

  const link = path.join(root, "private-link.json");
  await fs.symlink(file, link);
  await assert.rejects(
    readPrivateCandidateCaseInput(link),
    /private regular file/u,
  );
});
