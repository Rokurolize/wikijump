import assert from "node:assert/strict";
import {readFile, stat} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function extractPublishedPorts(compose) {
  const entries = [];
  let inside = false;
  let portsIndent = -1;
  for (const line of compose.split("\n")) {
    const indent = line.match(/^\s*/u)[0].length;
    if (/^\s*ports:\s*(?:!override\s*)?$/u.test(line)) {
      inside = true;
      portsIndent = indent;
      continue;
    }
    if (!inside) continue;
    if (indent <= portsIndent) {
      inside = false;
      continue;
    }
    const value = line.match(/^\s*-\s*(.+)$/u);
    if (value) entries.push(value[1].trim());
  }
  return entries;
}

test("every host-published port in the install/local Compose files is bound to loopback", async () => {
  const files = [
    "install/local/docker-compose.yaml",
    "install/local/docker-compose.dev.yaml",
    "install/local/docker-compose.user-test.yaml",
  ];
  for (const file of files) {
    const filePath = path.join(repositoryRoot, file);
    let exists = false;
    try {
      const stats = await stat(filePath);
      exists = stats.isFile();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    const text = await readFile(filePath, "utf8");
    const entries = extractPublishedPorts(text);
    for (const entry of entries) {
      const unquoted = entry.replace(/^["']|["']$/gu, "");
      assert.match(
        unquoted,
        /^(?:127\.0\.0\.1|\[::1\]):\d+:/u,
        `${file}: host publish is not loopback-bound: ${entry}`
      );
    }
  }
});
