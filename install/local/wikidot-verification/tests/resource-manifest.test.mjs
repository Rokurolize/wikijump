import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  assertFixtureResourceManifestEntry,
  assertResolvedPathWithin,
  buildFixtureResourceTargetPath,
  isWikidotResourceHost,
  resolveFixtureResourcePath,
} from "../src/resource-manifest.mjs";

test("resource manifest derives a deterministic query-sensitive target and validates its binding", () => {
  const localTargetPath = buildFixtureResourceTargetPath({
    fixtureSlug: "EN:alpha",
    site: "scp-wiki.wdfiles.com",
    wikidotPath: "/local--files/alpha/image.png",
    urlSearch: "?rev=2",
  });
  const entry = {
    filename: "image.png",
    fixture_slug: "EN:alpha",
    kind_guess: "image",
    local_target_path: localTargetPath,
    original_url: "https://scp-wiki.wdfiles.com/local--files/alpha/image.png?rev=2",
    sha256: "a".repeat(64),
    site: "scp-wiki.wdfiles.com",
    source_path: "source.wikidot.txt",
    wikidot_path: "/local--files/alpha/image.png",
  };
  assert.equal(isWikidotResourceHost(entry.site), true);
  assert.equal(assertFixtureResourceManifestEntry(entry, {requireSha256: true}), entry);
  assert.equal(resolveFixtureResourcePath("/tmp/root", localTargetPath), path.join("/tmp/root", localTargetPath));
  assert.doesNotThrow(() => assertResolvedPathWithin("/tmp/root", "/tmp/root/resources/file"));
  assert.throws(() => assertResolvedPathWithin("/tmp/root", "/tmp/elsewhere"), /escapes/u);
});

test("manifest host allowlist rejects lookalike suffix hosts", () => {
  assert.equal(isWikidotResourceHost("scp-wiki.wdfiles.com"), true);
  assert.equal(isWikidotResourceHost("scp-wiki.wikidot.com"), true);
  assert.equal(isWikidotResourceHost("scp-wiki.wikidot.com.evil.com"), false);
  assert.equal(isWikidotResourceHost("notwikidot.com"), false);
  assert.throws(
    () =>
      assertFixtureResourceManifestEntry(
        {
          filename: "image.png",
          fixture_slug: "EN:alpha",
          kind_guess: "image",
          local_target_path:
            "resources/EN:alpha/scp-wiki_wikidot_com_evil_com/local--files/alpha/image.png",
          original_url: "https://scp-wiki.wikidot.com.evil.com/local--files/alpha/image.png",
          sha256: null,
          site: "scp-wiki.wikidot.com.evil.com",
          source_path: "source.wikidot.txt",
          wikidot_path: "/local--files/alpha/image.png",
        },
        {},
      ),
    /out of scope/u,
  );
});

test("manifest site rejects a non-default port", () => {
  assert.throws(
    () =>
      buildFixtureResourceTargetPath({
        fixtureSlug: "EN:alpha",
        site: "scp-wiki.wdfiles.com:8080",
        wikidotPath: "/local--files/alpha/image.png",
        urlSearch: "",
      }),
    /canonical hostname/u,
  );
});

test("manifest paths reject encoded slashes and dot-dot segments", () => {
  assert.throws(
    () =>
      buildFixtureResourceTargetPath({
        fixtureSlug: "EN:alpha",
        site: "scp-wiki.wdfiles.com",
        wikidotPath: "/local--files/a%2Fb/image.png",
        urlSearch: "",
      }),
    /unsafe segment/u,
  );
  assert.throws(
    () => resolveFixtureResourcePath("/tmp/root", "resources/a/../b"),
    /remain below resources/u,
  );
});

test("manifest query suffix keeps a 16-character digest", () => {
  const first = buildFixtureResourceTargetPath({
    fixtureSlug: "EN:alpha",
    site: "scp-wiki.wdfiles.com",
    wikidotPath: "/local--files/alpha/image.png",
    urlSearch: "?rev=2",
  });
  const second = buildFixtureResourceTargetPath({
    fixtureSlug: "EN:alpha",
    site: "scp-wiki.wdfiles.com",
    wikidotPath: "/local--files/alpha/image.png",
    urlSearch: "?rev=3",
  });
  assert.match(first, /\.__query-[0-9a-f]{16}$/u);
  assert.match(second, /\.__query-[0-9a-f]{16}$/u);
  assert.notEqual(first, second);
});
