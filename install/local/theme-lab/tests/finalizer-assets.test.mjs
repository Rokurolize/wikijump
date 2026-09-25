import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const finalizer = path.resolve('ports/scripts/finalize_campaign.py');

test('campaign finalizer discovers only content-addressed local CSS assets', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'theme-lab-finalizer-assets-'));
  try {
    const hash = 'a'.repeat(64);
    const cssPath = path.join(directory, 'candidate-base.css');
    await fs.writeFile(cssPath, [
      `@font-face { src: url("/${hash}.woff2") format("woff2"); }`,
      'body { background: url("https://assets.example/bg.png"); }',
      `/* url("/${'b'.repeat(64)}.svg") */`
    ].join('\n'));
    const probe = [
      'import importlib.util, json, pathlib, sys',
      'spec = importlib.util.spec_from_file_location("finalizer", sys.argv[1])',
      'module = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(module)',
      'print(json.dumps(module.content_addressed_css_assets(pathlib.Path(sys.argv[2]))))'
    ].join('; ');
    const result = spawnSync('python3', ['-c', probe, finalizer, cssPath], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [`${hash}.woff2`]);
  } finally {
    await fs.rm(directory, {recursive: true, force: true});
  }
});
