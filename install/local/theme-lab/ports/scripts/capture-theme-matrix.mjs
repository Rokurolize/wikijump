#!/usr/bin/env node

// Keep the discoverable ports/scripts entry point, but do not maintain a
// second matrix scheduler here. The interactive fixture runner owns transport,
// bounded job concurrency, multi-theme batching, and targeted retries.
//
// Importing it preserves process.argv, so every CLI flag is forwarded exactly
// as if the canonical script had been invoked directly.
await import('../interactive-visual-fixture/capture-theme-matrix.mjs');
