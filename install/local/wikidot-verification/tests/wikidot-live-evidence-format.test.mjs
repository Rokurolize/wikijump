import assert from "node:assert/strict";
import test from "node:test";

import {
  parseWikidotLiveEvidenceRows,
  resolveWikidotLiveEvidenceFormat,
} from "../../../../scripts/lib/wikidot-live-evidence.mjs";

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
