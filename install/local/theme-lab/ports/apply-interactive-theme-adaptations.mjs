#!/usr/bin/env node
// Publication consumes only reviewed, hash-bound authority inputs. Historical
// campaign repairs live in maintenance/historical-diagnostic.* and are never
// replayed by this generator.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertPublishablePackage, digest, verifyEvidence} from '../src/adaptation-authority.mjs';
import {composeMaintainableCandidate} from './scripts/prepare-maintainable-sources.mjs';
const ports=path.dirname(fileURLToPath(import.meta.url));
const ledger=JSON.parse(await fs.readFile(path.join(ports,'adaptation-authority.json'),'utf8'));
const selected=new Set(process.argv.slice(2).filter(a=>a.startsWith('--theme=')).map(a=>a.slice(8)));
const results=[];
for(const [name,pkg] of Object.entries(ledger.packages)) {
  if(name==='quand-le-soleil-se-couche'||selected.size&&!selected.has(name)) continue;
  const dir=path.join(ports,name);
  verifyEvidence(pkg.blocks);
  for(const [file,sha] of Object.entries(pkg.inputs)) if(digest(await fs.readFile(path.join(dir,file)))!==sha) throw new Error(`${name}: unreviewed input ${file}`);
  const base=await fs.readFile(path.join(dir,'maintenance/authority-base.wikidot.txt'),'utf8');
  const css=await fs.readFile(path.join(dir,'authority-overrides.css'),'utf8');
  const source=name==='dear-dictator'?base:composeMaintainableCandidate(base,css);
  await fs.writeFile(path.join(dir,pkg.source_file),source);
  assertPublishablePackage(name);
  results.push({theme:name,source_sha256:digest(source)});
}
console.log(JSON.stringify({themes:results.length,adaptation:'authority-certified-only',results},null,2));
