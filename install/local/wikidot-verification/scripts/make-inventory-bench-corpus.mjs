// Synthetic documentation corpus for the campaign inventory BFS bench.
//
// The shape is chosen to exercise the traversal rather than to be realistic:
// a deep include chain drives recursion depth, a few hub pages accumulate many
// incoming edges, duplicated references force reason-set deduplication, and
// absent includes populate the missing-reference list.
//
// Usable as a module (makeCorpus) or a CLI (node make-inventory-bench-corpus.mjs <docsRoot> <pageCount> <fanIn>).
import fs from "node:fs/promises";
import path from "node:path";

async function writePage(docsRoot, fullname, source) {
  const pageDir = path.join(docsRoot, fullname);
  await fs.mkdir(pageDir, { recursive: true });
  await fs.writeFile(path.join(pageDir, "source.wikidot.txt"), source);
  await fs.writeFile(
    path.join(pageDir, "meta.json"),
    `${JSON.stringify({ fullname, title: fullname })}\n`
  );
}

export async function makeCorpus({ docsRoot, pageCount, fanIn }) {
  const regularPages = Array.from(
    { length: pageCount },
    (_, i) => `doc-regular:page-${i}`
  );

  await writePage(
    docsRoot,
    "doc-modules:start",
    [
      ...regularPages.map((name) => `* [[[${name} | ${name}]]]`),
      ...Array.from(
        { length: fanIn },
        (_, i) => `* [[[doc-include:snippet-0 | hub ${i}]]]`
      )
    ].join("\n")
  );
  await writePage(
    docsRoot,
    "doc-modules:listpages-module",
    "[[include doc-include:snippet-0]]\n"
  );

  // A wide include DAG over module documentation. Each page links forward to
  // the next `fanIn` module pages, which sort *after* the current one, so a
  // discovered target stays pending and the queue length tracks the edge count
  // rather than the node count. That is the shape the previous implementation
  // re-sorted on every discovered edge.
  for (let i = 0; i < pageCount; i += 1) {
    const body = [
      `++ Module ${i}`,
      `[[include doc-include:snippet-${i % pageCount}]]`,
      // Verbatim repeats, so a target's reason set has real duplicates.
      "[[include doc-include:snippet-0]]",
      "[[include doc-include:snippet-0]]",
      `[[include doc-include:absent-${i}]]`,
      '[[module ListPages category="design" perPage="10"]]'
    ];
    for (let f = 1; f <= fanIn; f += 1) {
      const target = i + f;
      if (target < pageCount) body.push(`[[include doc-modules:mod-${target}]]`);
    }
    await writePage(docsRoot, `doc-modules:mod-${i}`, `${body.join("\n")}\n`);
  }
  await writePage(docsRoot, "doc-modules:leaf", "Terminal module documentation.\n");

  for (let i = 0; i < pageCount; i += 1) {
    await writePage(docsRoot, `doc-include:snippet-${i}`, `Snippet ${i} content.\n`);
  }

  return { pages: pageCount, fanIn, expectedPages: pageCount * 2 + pageCount + 3 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [docsRoot, pageCountRaw, fanInRaw] = process.argv.slice(2);
  const pageCount = Number(pageCountRaw ?? 400);
  const fanIn = Number(fanInRaw ?? 40);
  const info = await makeCorpus({ docsRoot, pageCount, fanIn });
  process.stdout.write(`${JSON.stringify({ docsRoot, ...info })}\n`);
}
