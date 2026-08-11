import assert from "node:assert/strict";
import test from "node:test";

import { installCandidateFilePortRoute } from "../src/standing-browser-parity-browser-session.mjs";

test("candidate file routing maps only the exact canonical file authority to its sealed port", async () => {
  let pattern;
  let handler;
  const context = {
    async route(value, callback) {
      pattern = value;
      handler = callback;
    },
  };
  const origins = [
    "https://scp-wiki.wikijump.localhost:18449",
    "https://scp-wiki.wjfiles.localhost:18449",
  ];

  assert.equal(await installCandidateFilePortRoute(context, origins), true);
  assert.equal(pattern, "https://scp-wiki.wjfiles.localhost/**");

  const response = { status: 200 };
  let fetchOptions;
  let fulfillment;
  await handler({
    request() {
      return {
        url() {
          return "https://scp-wiki.wjfiles.localhost/local--files/scp-9506/NFSI.png?download=true";
        },
      };
    },
    async fetch(options) {
      fetchOptions = options;
      return response;
    },
    async fulfill(options) {
      fulfillment = options;
    },
  });
  assert.equal(
    fetchOptions.url,
    "https://scp-wiki.wjfiles.localhost:18449/local--files/scp-9506/NFSI.png?download=true",
  );
  assert.deepEqual(fulfillment, { response });
});

test("candidate file routing refuses malformed or ambiguous local origin declarations", async () => {
  const context = {
    async route() {
      throw new Error("must not install");
    },
  };
  await assert.rejects(
    installCandidateFilePortRoute(context, [
      "https://scp-wiki.wikijump.localhost:18449",
      "https://other.wjfiles.localhost:18449",
    ]),
    /same site slug/u,
  );
  await assert.rejects(
    installCandidateFilePortRoute(context, [
      "https://scp-wiki.wikijump.localhost:18449",
      "https://scp-wiki.wjfiles.localhost",
    ]),
    /same explicit non-443 port/u,
  );
});
