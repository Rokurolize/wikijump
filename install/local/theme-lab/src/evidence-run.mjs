// Wire one run's artifact directory into the content-addressed evidence
// store (#2752): ingest deduplicates every blob by SHA-256 into the
// store's object pool and writes a per-package manifest mapping the
// run's relative paths to hashes; materialize then replaces the run's
// files with hardlinks to the stored objects, so the view a human or
// agent inspects costs inodes, not duplicate bytes. A fresh regression
// whose captures are byte-identical to a previous run adds no new
// objects at all.
import path from 'node:path';

import {ingest, materialize} from './evidence-store.mjs';

export async function storeRunArtifacts(artifactDir, {store, manifestPath}) {
  const ingested = await ingest(artifactDir, manifestPath, store);
  const view = await materialize(manifestPath, artifactDir, store);
  return {
    manifest: path.resolve(manifestPath),
    files: ingested.files,
    total_bytes: ingested.totalBytes,
    new_objects: ingested.newObjects,
    new_bytes: ingested.newBytes,
    linked: view.linked,
    copied: view.copied,
  };
}
