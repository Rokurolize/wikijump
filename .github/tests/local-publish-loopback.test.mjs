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

function unquote(entry) {
  return entry.replace(/^["']|["']$/gu, "");
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
      assert.match(
        unquote(entry),
        /^(?:127\.0\.0\.1|\[::1\]):\d+:/u,
        `${file}: host publish is not loopback-bound: ${entry}`
      );
    }
  }
});

test("install/local mirrors every IPv4 loopback publication on IPv6 loopback", async () => {
  const text = await readFile(path.join(repositoryRoot, "install/local/docker-compose.yaml"), "utf8");
  const entries = extractPublishedPorts(text).map(unquote);
  const ipv4 = entries.filter((entry) => entry.startsWith("127.0.0.1:")).map((entry) => entry.slice("127.0.0.1:".length)).sort();
  const ipv6 = entries.filter((entry) => entry.startsWith("[::1]:")).map((entry) => entry.slice("[::1]:".length)).sort();
  assert.deepEqual(ipv6, ipv4);
});

test("Compose default networks enable IPv6 with distinct ULA subnets", async () => {
  const expected = new Map([
    ["install/local/docker-compose.yaml", "fd7a:4f2c:9100:1::/64"],
    ["install/dev/docker-compose.yaml", "fd7a:4f2c:9100:2::/64"],
    ["install/dev/komodo/docker-compose.yaml", "fd7a:4f2c:9100:3::/64"],
    ["install/standing/compose.yaml", "fd7a:4f2c:9100:4::/64"],
  ]);
  const subnets = new Set();
  for (const [file, subnet] of expected) {
    const text = await readFile(path.join(repositoryRoot, file), "utf8");
    assert.match(text, /^networks:\n  default:/mu, `${file}: default network is not configured`);
    assert.match(text, /^    enable_ipv6: true$/mu, `${file}: IPv6 is not enabled`);
    assert.ok(text.includes(`- subnet: "${subnet}"`), `${file}: missing ${subnet}`);
    subnets.add(subnet);
  }
  assert.equal(subnets.size, expected.size);
});

test("Komodo Periphery allows the dev and Komodo Compose IPv6 networks", async () => {
  const text = await readFile(path.join(repositoryRoot, "install/dev/komodo/compose.env.example"), "utf8");
  const entries = text.match(/^PERIPHERY_ALLOWED_IPS=(.+)$/mu)[1].trim().split(",");
  assert.ok(entries.includes("fd7a:4f2c:9100:2::/64"));
  assert.ok(entries.includes("fd7a:4f2c:9100:3::/64"));
});
