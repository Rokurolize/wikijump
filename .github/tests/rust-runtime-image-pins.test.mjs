import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => readFile(path.join(repositoryRoot, relative), "utf8");
const images = (dockerfile) => [...dockerfile.matchAll(/^FROM\s+(\S+)/gmu)].map((match) => match[1]);

test("Rust service runtime images share one pinned Debian runtime", async () => {
  const dockerfiles = [
    "install/dev/deepwell/Dockerfile",
    "install/dev/wws/Dockerfile",
    "install/prod/deepwell/Dockerfile",
    "install/prod/wws/Dockerfile",
  ];
  const runtimeImages = [];

  for (const dockerfile of dockerfiles) {
    const stages = images(await read(dockerfile));
    assert.ok(stages.length >= 2, dockerfile);
    assert.match(stages.at(-1), /^debian:[^@]+@sha256:[0-9a-f]{64}$/u, dockerfile);
    runtimeImages.push(stages.at(-1));
  }

  assert.equal(new Set(runtimeImages).size, 1, runtimeImages.join(", "));
});
