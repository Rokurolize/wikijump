import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {captureVisualPair} from '../src/visual-diff.mjs';

// A stub page records the order of pointer moves and screenshots. evaluate() returns a
// safe-area point only for the pointer-park function, which is recognised by its source.
function stubPage(name, events) {
  return {
    async setViewportSize(size) { events.push(`${name}:viewport:${size.width}x${size.height}`); },
    async evaluate(fn) {
      const source = String(fn);
      if (source.includes('innerWidth') && source.includes('elementFromPoint')) return {x: 1437, y: 997};
      return undefined;
    },
    mouse: {
      async move(x, y) { events.push(`${name}:mouse:${x},${y}`); },
    },
    async screenshot({path: target}) {
      events.push(`${name}:screenshot`);
      fs.writeFileSync(target, 'png-stub');
    },
  };
}

test('full-check visual capture parks the candidate pointer before every screenshot', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-park-'));
  const events = [];
  const candidate = stubPage('candidate', events);
  await captureVisualPair({
    candidatePage: candidate,
    referencePage: null,
    viewports: [{id: 'desktop', width: 1440, height: 1000}],
    outputDir,
  });
  const park = events.indexOf('candidate:mouse:1437,997');
  const shot = events.indexOf('candidate:screenshot');
  assert.ok(park >= 0, 'pointer parked at a safe-area point');
  assert.ok(park < shot, 'pointer parked before the screenshot');
  assert.ok(events.indexOf('candidate:viewport:1440x1000') < park, 'viewport set before parking');
});

test('paired visual capture parks both pointers before the paired screenshots', async () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-park-pair-'));
  const events = [];
  const candidate = stubPage('candidate', events);
  const reference = stubPage('reference', events);
  await captureVisualPair({
    candidatePage: candidate,
    referencePage: reference,
    viewports: [{id: 'mobile', width: 390, height: 844}],
    outputDir,
  }).catch(() => {});
  const candidatePark = events.indexOf('candidate:mouse:1437,997');
  const referencePark = events.indexOf('reference:mouse:1437,997');
  const firstShot = Math.min(...['candidate:screenshot', 'reference:screenshot'].map(name => events.indexOf(name)).filter(index => index >= 0));
  assert.ok(candidatePark >= 0 && referencePark >= 0, 'both pages parked');
  assert.ok(Math.max(candidatePark, referencePark) < firstShot, 'both parks happen before any paired screenshot');
});
