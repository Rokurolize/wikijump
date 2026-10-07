import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const exact=value=>/^[0-9a-f]{64}$/u.test(value??'');

// Compression preserves the native JSON bytes. Bind both the stored object
// and its expanded evidence so transport cannot change the acceptance input.
export function readBoundArtifact(root,binding,label) {
  if(!binding||typeof binding.path!=='string'||!exact(binding.sha256))throw new Error(`${label}: missing exact artifact binding`);
  const file=path.resolve(root,binding.path);
  if(!file.startsWith(path.resolve(root)+path.sep))throw new Error(`${label}: artifact escapes Theme Lab`);
  const bytes=fs.readFileSync(file);
  if(sha(bytes)!==binding.sha256)throw new Error(`${label}: stale artifact ${binding.path}`);
  if(binding.encoding===undefined)return bytes;
  if(binding.encoding!=='gzip'||!exact(binding.uncompressed_sha256))throw new Error(`${label}: invalid artifact encoding or expanded binding`);
  const expanded=gunzipSync(bytes);
  if(sha(expanded)!==binding.uncompressed_sha256)throw new Error(`${label}: stale expanded artifact ${binding.path}`);
  return expanded;
}
