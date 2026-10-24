import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

const themeLab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portsDir = path.join(themeLab, 'ports');
const imageExtension = /\.(?:png|jpe?g|webp)$/iu;
const contentAddressedSuffix = /-([a-f0-9]{64})(\.(?:png|jpe?g|webp))$/iu;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('interactive screenshot artifacts do not keep identical unsuffixed aliases', () => {
  const violations = [];
  function visit(directory) {
    const entries = fs.readdirSync(directory, {withFileTypes: true});
    const names = new Set(entries.map(entry => entry.name));
    const relative = path.relative(portsDir, directory).split(path.sep);
    const interactive = relative.some((part, index) => part === 'artifacts' && relative[index + 1] === 'interactive');

    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(file);
        continue;
      }
      if (!interactive || !entry.isFile() || !imageExtension.test(entry.name)) continue;

      const name = entry.name;
      if (contentAddressedSuffix.test(name)) continue;
      const extension = path.extname(name);
      const stem = name.slice(0, -extension.length);
      // Only read candidates that have a SHA-named sibling with this same
      // state stem. Unique historical states have no such sibling and stay.
      const siblings = [...names].filter(candidate => candidate.startsWith(`${stem}-`) && candidate.endsWith(extension) && contentAddressedSuffix.test(candidate));
      if (!siblings.length) continue;

      const bytes = fs.readFileSync(file);
      const digest = sha256(bytes);
      const canonical = `${stem}-${digest}${extension}`;
      if (!names.has(canonical)) continue;
      const canonicalBytes = fs.readFileSync(path.join(directory, canonical));
      if (bytes.equals(canonicalBytes)) violations.push(path.relative(themeLab, file).split(path.sep).join('/'));
    }
  }
  visit(portsDir);

  assert.deepEqual(violations, [], `remove byte-identical unsuffixed screenshot aliases:\n${violations.join('\n')}`);
});
