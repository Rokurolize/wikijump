import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  classifyListPagesPreviewDifferential,
  writeListPagesPreviewClassification,
} from "../src/listpages-preview-classification.mjs";
import {
  parseArgs as parsePreviewClassificationArgs,
} from "../scripts/classify-listpages-preview-differential.mjs";
import {
  canonicalDom,
  sha256,
  visibleText,
} from "../src/syntax-differential.mjs";

const referenceIdentities = new Map();

function reference(caseId, source, rawHtml) {
  const row = {
    schema: "wikijump_syntax_differential.wikidot_reference.v1",
    syntax_case: {
      schema: "wikijump_syntax_differential.syntax_case.v1",
      case_id: caseId,
      source,
      title: caseId,
      wikidot_observation_tier: "page-preview",
      local_execution_tier: "wikijump-runtime",
    },
    source_sha256: sha256(source),
    captured_at: "2026-07-27T00:00:00+00:00",
    provenance: {
      site: "sandbox-for-codex",
      site_domain: "sandbox-for-codex.wikidot.com",
      module: "edit/PagePreviewModule",
      wikidot_py_version: "4.4.1",
      wikidot_py_commit: "4af7c8eaec00a3e7a29fe502234e0aeeef968233",
      requirements_sha256: "c".repeat(64),
      authenticated: false,
      mutated: false,
    },
    raw_html: rawHtml,
    raw_html_sha256: sha256(rawHtml),
  };
  referenceIdentities.set(caseId, {
    source_sha256: row.source_sha256,
    live_html_sha256: row.raw_html_sha256,
  });
  return row;
}

function mismatchCase(caseId, liveHtml, localHtml) {
  return {
    case_id: caseId,
    status: "mismatch",
    live: { visible_text: visibleText(liveHtml) },
    local: {
      visible_text: visibleText(localHtml),
      html_sha256: sha256(localHtml),
    },
    comparison: {
      identities: referenceIdentities.get(caseId),
      checks: {
        dom_tree: {
          status: "mismatch",
          local: canonicalDom(localHtml),
        },
      },
    },
  };
}

async function liveArtifactReference(fileName, caseId) {
  const text = await fs.readFile(
    new URL(`../artifacts/${fileName}`, import.meta.url),
    "utf8",
  );
  const row = text
    .trimEnd()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line))
    .find((candidate) => candidate.syntax_case?.case_id === caseId);
  assert.ok(row, `missing live artifact case ${caseId}`);
  referenceIdentities.set(caseId, {
    source_sha256: row.source_sha256,
    live_html_sha256: row.raw_html_sha256,
  });
  return row;
}

async function writeIdentityFixture({
  references,
  cases,
}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-identity-classify-"),
  );
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  await fs.writeFile(
    referencesPath,
    references.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
  await fs.writeFile(
    verdictPath,
    JSON.stringify({ cases }),
  );
  return { referencesPath, verdictPath };
}

function identityBoundMatch(referenceRow, overrides = {}) {
  return {
    case_id: referenceRow.syntax_case.case_id,
    status: "match",
    comparison: {
      identities: {
        source_sha256: referenceRow.source_sha256,
        live_html_sha256: referenceRow.raw_html_sha256,
      },
    },
    ...overrides,
  };
}

test("preview classifier requires a case-ID bijection", async () => {
  const first = reference("case-a", "source a", "<p>a</p>");
  const second = reference("case-b", "source b", "<p>b</p>");

  await assert.rejects(
    classifyListPagesPreviewDifferential(await writeIdentityFixture({
      references: [first, second],
      cases: [
        identityBoundMatch(first),
        identityBoundMatch(first),
      ],
    })),
    /duplicate verdict case ID case-a/,
  );

  await assert.rejects(
    classifyListPagesPreviewDifferential(await writeIdentityFixture({
      references: [first, first],
      cases: [
        identityBoundMatch(first),
        identityBoundMatch(second),
      ],
    })),
    /duplicate live reference case ID case-a/,
  );

  await assert.rejects(
    classifyListPagesPreviewDifferential(await writeIdentityFixture({
      references: [first, second],
      cases: [identityBoundMatch(first)],
    })),
    /verdict\/reference case IDs differ.*missing case-b/,
  );

  const extra = reference("case-c", "source c", "<p>c</p>");
  await assert.rejects(
    classifyListPagesPreviewDifferential(await writeIdentityFixture({
      references: [first, second],
      cases: [
        identityBoundMatch(first),
        identityBoundMatch(extra),
      ],
    })),
    /verdict\/reference case IDs differ.*missing case-b.*extra case-c/,
  );
});

test("preview classifier binds every verdict row to source and live HTML identities", async () => {
  const live = reference("case-a", "source a", "<p>a</p>");

  for (const [name, identities] of [
    ["missing", undefined],
    ["source", {
      source_sha256: "0".repeat(64),
      live_html_sha256: live.raw_html_sha256,
    }],
    ["live HTML", {
      source_sha256: live.source_sha256,
      live_html_sha256: "0".repeat(64),
    }],
  ]) {
    const row = identityBoundMatch(live);
    row.comparison.identities = identities;
    await assert.rejects(
      classifyListPagesPreviewDifferential(await writeIdentityFixture({
        references: [live],
        cases: [row],
      })),
      new RegExp(`verdict ${name} identity`, "u"),
    );
  }
});

test("authoritative classification preserves and revalidates the runtime identity chain", async () => {
  const live = reference("case-a", "source a", "<p>a</p>");
  const fixture = await writeIdentityFixture({
    references: [live],
    cases: [identityBoundMatch(live)],
  });
  const runtimeIdentityPath = path.join(
    path.dirname(fixture.verdictPath),
    "runtime-identity.json",
  );
  const runtimeProofPath = path.join(
    path.dirname(fixture.verdictPath),
    "runtime-proof.json",
  );
  const runtimeIdentityText = '{"schema":"validated-runtime-identity"}\n';
  const runtimeProofText = '{"schema":"validated-running-proof"}\n';
  await fs.writeFile(runtimeIdentityPath, runtimeIdentityText);
  await fs.writeFile(runtimeProofPath, runtimeProofText);
  const verdict = JSON.parse(await fs.readFile(fixture.verdictPath, "utf8"));
  const referencesText = await fs.readFile(fixture.referencesPath, "utf8");
  verdict.inputs = {
    authority: { mode: "authoritative", completion_eligible: true },
    references_path: fixture.referencesPath,
    references_sha256: sha256(referencesText),
    runtime_identity_path: runtimeIdentityPath,
    runtime_identity_sha256: sha256(runtimeIdentityText),
    runtime_proof_path: runtimeProofPath,
    runtime_proof_sha256: sha256(runtimeProofText),
  };
  await fs.writeFile(fixture.verdictPath, JSON.stringify(verdict));

  const classified = await classifyListPagesPreviewDifferential({
    ...fixture,
    authoritative: true,
  });
  assert.deepEqual(classified.inputs.authority, {
    mode: "authoritative",
    completion_eligible: true,
    runtime_identity_sha256: sha256(runtimeIdentityText),
    runtime_proof_sha256: sha256(runtimeProofText),
  });

  await fs.writeFile(runtimeIdentityPath, '{"changed":true}\n');
  await assert.rejects(
    classifyListPagesPreviewDifferential({
      ...fixture,
      authoritative: true,
    }),
    /runtime identity changed after the preview verdict/,
  );

  verdict.inputs.authority = {
    mode: "diagnostic",
    completion_eligible: false,
  };
  await fs.writeFile(fixture.verdictPath, JSON.stringify(verdict));
  await assert.rejects(
    classifyListPagesPreviewDifferential({
      ...fixture,
      authoritative: true,
    }),
    /authoritative classification requires an authoritative preview verdict/,
  );
});

test("classification CLI and writer preserve authoritative evidence", async () => {
  const parsed = parsePreviewClassificationArgs([
    "node",
    "classify-listpages-preview-differential.mjs",
    "--verdict",
    "verdict.json",
    "--references",
    "references.jsonl",
    "--authoritative",
    "--output",
    "classification.json",
  ]);
  assert.equal(parsed.authoritative, true);

  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "wj-listpages-classification-output-"),
  );
  const output = path.join(root, "classification.json");
  const classification = { schema: "classification" };
  await writeListPagesPreviewClassification(classification, output);
  await assert.rejects(
    writeListPagesPreviewClassification(classification, output),
    (error) => error?.code === "EEXIST",
  );
});

test("preview classifier separates oracle defects from fixture-state mismatches", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const references = [
    reference(
      "invalid-range",
      '[[module ListPages range="bogus"]]\n%%title%%\n[[/module]]',
      '<div class="error-block">Invalid range argument.</div>',
    ),
    reference(
      "data",
      "[[module ListPages]]\n%%title%%\n[[/module]]",
      '<div class="list-pages-box"><div class="list-pages-item">live</div></div>',
    ),
    reference(
      "local-todo",
      "[[module ListPages]]\n[[#expr 1 + 1]]\n[[/module]]",
      '<div class="list-pages-box"></div>',
    ),
  ];
  await fs.writeFile(
    referencesPath,
    references.map((row) => `${JSON.stringify(row)}\n`).join(""),
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [
      mismatchCase(
        "invalid-range",
        '<div class="error-block">Invalid range argument.</div>',
        "",
      ),
      mismatchCase(
        "data",
        '<div class="list-pages-box"><div class="list-pages-item">live</div></div>',
        '<div class="list-pages-box"><div class="list-pages-item">local</div></div>',
      ),
      mismatchCase(
        "local-todo",
        '<div class="list-pages-box"></div>',
        "<p>TODO: module ListPages</p>",
      ),
    ],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(result.summary.classifications["invalid-range-error"], 1);
  assert.equal(result.summary.classifications["inconclusive-fixture-data-state"], 1);
  assert.equal(
    result.summary.classifications["local-listpages-unsupported-diagnostic"],
    1,
  );
  assert.equal(
    result.cases.find((row) => row.case_id === "local-todo").disposition,
    "investigate-renderer",
  );
});

test("preview classifier recognizes executed wrapper-free modules", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages separate="no" wrapper="no"]]',
    "%%index%%. %%title%%",
    "[[/module]]",
  ].join("\n");
  const liveHtml = "<p>1. live one<br>2. live two</p><div class=\"pager\">pages</div>";
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("wrapper-free", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [{
      case_id: "wrapper-free",
      status: "mismatch",
      live: { visible_text: "1. live one\n2. live two" },
      local: { visible_text: "1. local", html_sha256: "c".repeat(64) },
      comparison: {
        identities: referenceIdentities.get("wrapper-free"),
        checks: {
          dom_tree: {
            status: "mismatch",
            local: [{
              attrs: [],
              children: [{ type: "text", value: "1. local" }],
            }],
          },
        },
      },
    }],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "inconclusive-fixture-data-state",
  );
});

test("preview classifier does not mask a missing zero-row line as fixture state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages tags="+absent" separate="no" prependLine="ZERO_PRE"]]',
    "%%slug%%",
    "[[/module]]",
  ].join("\n");
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference(
      "zero-row-prepend",
      source,
      '<div class="list-pages-box"><p>ZERO_PRE</p></div>',
    ))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [{
      case_id: "zero-row-prepend",
      status: "mismatch",
      live: { visible_text: "ZERO_PRE" },
      local: { visible_text: "", html_sha256: "c".repeat(64) },
      comparison: {
        identities: referenceIdentities.get("zero-row-prepend"),
        checks: {
          dom_tree: {
            status: "mismatch",
            local: [{
              attrs: [{ name: "class", value: "list-pages-box" }],
              children: [],
            }],
          },
        },
      },
    }],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "prepend-append-line-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-renderer");
});

test("literal-context replay isolates ListPages ownership from unrelated rendering drift", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-literal-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    "[[code]]",
    '[[module ListPages tags="+example"]]',
    "%%title%%",
    "[[/module]]",
    "[[/code]]",
  ].join("\n");
  const cases = [
    {
      caseId: "literal-ok:literal-context",
      localText: '[[module ListPages tags="+example"]]\n%%title%%\n[[/module]]\n',
      localDom: [{
        attrs: [{ name: "class", value: "code" }],
        children: [],
      }],
    },
    {
      caseId: "literal-todo:literal-context",
      localText: "TODO: module ListPages",
      localDom: [],
    },
    {
      caseId: "literal-executed:literal-context",
      localText: "local row",
      localDom: [{
        attrs: [{ name: "class", value: "list-pages-box" }],
        children: [],
      }],
    },
  ];
  await fs.writeFile(
    referencesPath,
    cases.map(({ caseId }) => `${JSON.stringify(reference(
      caseId,
      source,
      '<div class="code">[[module ListPages tags="+example"]]\n%%title%%\n[[/module]]</div>',
    ))}\n`).join(""),
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: cases.map(({ caseId, localText, localDom }) => ({
      case_id: caseId,
      status: "mismatch",
      live: {
        visible_text: '[[module ListPages tags="+example"]]\n%%title%%\n[[/module]]',
      },
      local: { visible_text: localText, html_sha256: "d".repeat(64) },
      comparison: {
        identities: referenceIdentities.get(caseId),
        checks: {
          dom_tree: { status: "mismatch", local: localDom },
        },
      },
    })),
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.deepEqual(
    result.cases[0],
    {
      ...result.cases[0],
      case_id: "literal-ok:literal-context",
      classification: "literal-context-nonexecution-parity",
      disposition: "none",
    },
  );
  for (const caseId of [
    "literal-todo:literal-context",
    "literal-executed:literal-context",
  ]) {
    const classified = result.cases.find((row) => row.case_id === caseId);
    assert.notEqual(
      classified.disposition,
      "none",
      `${caseId} must remain actionable when local output executes or diagnoses ListPages`,
    );
  }
});

test("preview classifier does not mask a missing wrapper as fixture state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages wrapper="yes" separate="no"]]',
    '[[div class="authored-row-content"]]',
    '[[div class="list-pages-box"]]SAME_ROW[[/div]]',
    "[[/div]]",
    "[[/module]]",
  ].join("\n");
  const localHtml = [
    '<div class="authored-row-content">',
    '<div class="list-pages-box">SAME_ROW</div>',
    "</div>",
  ].join("");
  const liveHtml = `<div class="list-pages-box">${localHtml}</div>`;
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("missing-wrapper", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("missing-wrapper", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-render-shape-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-renderer");
});

test("preview classifier does not discard live siblings when proving a missing wrapper", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages wrapper="yes" separate="no"]]',
    "%%content%%",
    "[[/module]]",
  ].join("\n");
  const localHtml = '<div class="authored-row-content">SAME_ROW</div>';
  const liveHtml = [
    `<div class="list-pages-box">${localHtml}</div>`,
    '<div class="pager">PAGE_TWO</div>',
  ].join("");
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("wrapper-with-live-sibling", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase(
      "wrapper-with-live-sibling",
      liveHtml,
      localHtml,
    )],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "inconclusive-fixture-data-state",
  );
  assert.equal(result.cases[0].disposition, "replay-synchronized-fixture");
});

test("preview classifier ignores descendant wrapper classes in wrapper-free row data", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages wrapper="no" separate="no"]]',
    "%%content%%",
    "[[/module]]",
  ].join("\n");
  const liveHtml = [
    '<div class="authored-row-content">',
    '<div class="list-pages-box">LIVE_ROW</div>',
    "</div>",
  ].join("");
  const localHtml = '<div class="authored-row-content">LOCAL_ROW</div>';
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("wrapper-free-row", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("wrapper-free-row", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "inconclusive-fixture-data-state",
  );
  assert.equal(result.cases[0].disposition, "replay-synchronized-fixture");
});

test("preview classifier uses a variable-bearing body anchor to detect a missing authored head", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const liveReference = await liveArtifactReference(
    "listpages-sections-partial-live.jsonl",
    "listpages-one-row-head-body-separate-no",
  );
  const liveHtml = liveReference.raw_html;
  const localHtml =
    '<div class="list-pages-box"><p>ROW=main:about</p></div>';
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(liveReference)}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase(
      liveReference.syntax_case.case_id,
      liveHtml,
      localHtml,
    )],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-section-template-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-renderer");
});

test("preview classifier uses a variable-bearing body anchor to detect a missing authored foot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const liveReference = await liveArtifactReference(
    "listpages-sections-partial-live.jsonl",
    "listpages-one-row-body-foot-separate-no",
  );
  const liveHtml = liveReference.raw_html;
  const localHtml =
    '<div class="list-pages-box"><p>ROW=main:about</p></div>';
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(liveReference)}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase(
      liveReference.syntax_case.case_id,
      liveHtml,
      localHtml,
    )],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-section-template-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-renderer");
});

test("preview classifier leaves an ambiguous section and row-text collision as fixture state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages category="*" fullname="main:about" separate="no"]]',
    "[[head]]News[[/head]]",
    "[[body]]%%title%%[[/body]]",
    "[[/module]]",
  ].join("\n");
  const liveHtml =
    '<div class="list-pages-box"><p>News<br>Live title</p></div>';
  const localHtml = '<div class="list-pages-box"><p>News</p></div>';
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("ambiguous-head-row", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("ambiguous-head-row", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "inconclusive-fixture-data-state",
  );
  assert.equal(result.cases[0].disposition, "replay-synchronized-fixture");
});

test("preview classifier checks all foot occurrences around a variable-bearing body anchor", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages category="*" fullname="main:about" separate="no"]]',
    "[[body]]%%title%%",
    "ROW_ANCHOR=%%fullname%%[[/body]]",
    "[[foot]]FOOT[[/foot]]",
    "[[/module]]",
  ].join("\n");
  const liveHtml = [
    '<div class="list-pages-box"><p>',
    "Live title<br>ROW_ANCHOR=main:about<br>FOOT",
    "</p></div>",
  ].join("");
  const localHtml = [
    '<div class="list-pages-box"><p>',
    "FOOT<br>ROW_ANCHOR=main:about<br>FOOT",
    "</p></div>",
  ].join("");
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("foot-row-collision", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("foot-row-collision", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "inconclusive-fixture-data-state",
  );
  assert.equal(result.cases[0].disposition, "replay-synchronized-fixture");
});

test("preview classifier requires an authored foot after the final body row", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wj-listpages-classify-"));
  const referencesPath = path.join(root, "references.jsonl");
  const verdictPath = path.join(root, "verdict.json");
  const source = [
    '[[module ListPages category="*" separate="no"]]',
    "[[body]]%%title%%",
    "ROW_ANCHOR=%%fullname%%[[/body]]",
    "[[foot]]FOOT[[/foot]]",
    "[[/module]]",
  ].join("\n");
  const liveHtml = [
    '<div class="list-pages-box"><p>',
    "Live one<br>ROW_ANCHOR=main:one<br>",
    "Live two<br>ROW_ANCHOR=main:two<br>FOOT",
    "</p></div>",
  ].join("");
  const localHtml = [
    '<div class="list-pages-box"><p>',
    "Local one<br>ROW_ANCHOR=main:one<br>",
    "FOOT<br>ROW_ANCHOR=main:two",
    "</p></div>",
  ].join("");
  await fs.writeFile(
    referencesPath,
    `${JSON.stringify(reference("foot-before-final-row", source, liveHtml))}\n`,
  );
  await fs.writeFile(verdictPath, JSON.stringify({
    cases: [mismatchCase("foot-before-final-row", liveHtml, localHtml)],
  }));

  const result = await classifyListPagesPreviewDifferential({
    verdictPath,
    referencesPath,
  });
  assert.equal(
    result.cases[0].classification,
    "listpages-section-template-divergence",
  );
  assert.equal(result.cases[0].disposition, "investigate-renderer");
});
