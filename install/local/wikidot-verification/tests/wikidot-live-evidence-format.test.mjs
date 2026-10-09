import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";

import {
  parseWikidotLiveEvidenceRows,
  resolveWikidotLiveEvidenceFormat,
  verifiedExternalEvidenceCaseIds,
  verifiedNativeThemeCaseIds,
} from "../../../../scripts/lib/wikidot-live-evidence.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("generator evidence parsing rejects undeclared malformed .json", () => {
  assert.throws(
    () =>
      parseWikidotLiveEvidenceRows(
        '{"case_id":"first"}\n{"case_id":"second"}\n',
        resolveWikidotLiveEvidenceFormat({ path: "malformed.json" }),
      ),
    SyntaxError,
  );
});

test("generator evidence parsing accepts declared JSONL in a .json artifact", () => {
  assert.deepEqual(
    parseWikidotLiveEvidenceRows(
      '{"case_id":"first"}\n{"case_id":"second"}\n',
      resolveWikidotLiveEvidenceFormat({
        path: "captured-as-json.json",
        format: "jsonl",
      }),
    ),
    [{ case_id: "first" }, { case_id: "second" }],
  );
});

test("unknown evidence formats are rejected", () => {
  assert.throws(
    () =>
      resolveWikidotLiveEvidenceFormat({
        path: "evidence.json",
        format: "json-lines",
      }),
    /Unsupported Wikidot live evidence format/u,
  );
});

test("native theme controls require the independently retained source and response bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "wikidot-native-theme-evidence-"));
  try {
    const source = '[[module ThemePreviewer noUi="true" theme_url=" "]]';
    const response = JSON.stringify({status: "ok", body: ""});
    writeFileSync(join(root, "spaced-source.wikidot.txt"), source);
    writeFileSync(join(root, "spaced-response.json"), response);
    const receipt = {schema: "theme_lab_native_theme_previewer_preview_boundary.v1", actor: "anonymous", public_writes: 0, rows: [{id: "spaced", source_sha256: sha256(source), response_sha256: sha256(response), http_status: 200, body: ""}]};
    assert.deepEqual(verifiedNativeThemeCaseIds(receipt, root), new Set(["spaced"]));
    assert.throws(() => verifiedNativeThemeCaseIds({...receipt, rows: [receipt.rows[0], receipt.rows[0]]}, root), /duplicate/u);
    assert.throws(() => verifiedNativeThemeCaseIds({...receipt, public_writes: 1}, root), /anonymous read-only/u);
    writeFileSync(join(root, "spaced-source.wikidot.txt"), "different source");
    assert.throws(() => verifiedNativeThemeCaseIds(receipt, root), /hash drifted/u);
    writeFileSync(join(root, "spaced-source.wikidot.txt"), source);
    writeFileSync(join(root, "spaced-response.json"), JSON.stringify({status: "error", body: ""}));
    assert.throws(() => verifiedNativeThemeCaseIds(receipt, root), /hash drifted/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test("saved native theme controls bind original HTML rather than their summary", () => {
  const root = mkdtempSync(join(tmpdir(), "wikidot-native-saved-theme-"));
  try {
    const html = '<style>@import url("/common--theme/base/css/style.css");</style>';
    writeFileSync(join(root, "original.html"), html);
    const receipt = {schema: "theme_lab_native_saved_theme_reset.v1", actor: "anonymous", public_writes: 0, rows: [{url: "https://example.wikidot.com/page", original_html: {path: "original.html", sha256: sha256(html)}}]};
    assert.deepEqual(verifiedNativeThemeCaseIds(receipt, root), new Set(["https://example.wikidot.com/page"]));
    writeFileSync(join(root, "original.html"), "summary alone");
    assert.throws(() => verifiedNativeThemeCaseIds(receipt, root), /hash drifted/u);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test("summary case IDs require hashed raw external captures", () => {
  const root = mkdtempSync(join(tmpdir(), "wikidot-live-evidence-"));
  try {
    mkdirSync(join(root, "raw"));
    const rawPath = join(root, "raw", "case.json");
    const raw = Buffer.from('{"case_id":"case"}\n');
    writeFileSync(rawPath, raw);
    const indexPath = join(root, "index.json");
    const index = Buffer.from(JSON.stringify({
      entries: [{case_id: "case", path: rawPath, sha256: sha256(raw)}],
    }));
    writeFileSync(indexPath, index);
    const sumsPath = join(root, "SHA256SUMS");
    const sums = Buffer.from(`${sha256(index)}  index.json\n${sha256(raw)}  raw/case.json\n`);
    writeFileSync(sumsPath, sums);

    const capturedCaseIds = verifiedExternalEvidenceCaseIds({
        external_sha256s: {path: sumsPath, sha256: sha256(sums)},
        external_indices: [{path: indexPath, sha256: sha256(index), cases: 1}],
      });
    assert.deepEqual(capturedCaseIds, new Set(["case"]));
    assert.equal(capturedCaseIds.has("forged"), false);
    const forgedIndex = Buffer.from(JSON.stringify({
      entries: [{case_id: "forged", path: rawPath, sha256: sha256(raw)}],
    }));
    writeFileSync(indexPath, forgedIndex);
    const forgedSums = Buffer.from(`${sha256(forgedIndex)}  index.json\n${sha256(raw)}  raw/case.json\n`);
    writeFileSync(sumsPath, forgedSums);
    assert.throws(
      () => verifiedExternalEvidenceCaseIds({
        external_sha256s: {path: sumsPath, sha256: sha256(forgedSums)},
        external_indices: [{path: indexPath, sha256: sha256(forgedIndex), cases: 1}],
      }),
      /External evidence case ID drifted/u,
    );
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
