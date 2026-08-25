import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateLocalOriginSets,
  isParityBrowserPublicOrigin,
  installCandidateFilePortRoute,
  parityBrowserThrottleConfig,
} from "../src/standing-browser-parity-browser-session.mjs";

const hash = (character) => character.repeat(64);

test("candidate browser local origins include every sealed site on an editable candidate", () => {
  const sets = candidateLocalOriginSets({
    candidate: {
      endpoint: {
        allowed_origin_set: [
          "https://scpaiueouiuiuiui.wikijump.localhost:18449",
          "https://scpaiueouiuiuiui.wjfiles.localhost:18449",
        ],
      },
      site_origins: {
        "scp-wiki": {
          page: "https://scp-wiki.wikijump.localhost:18449",
          files: "https://scp-wiki.wjfiles.localhost:18449",
        },
        scpaiueouiuiuiui: {
          page: "https://scpaiueouiuiuiui.wikijump.localhost:18449",
          files: "https://scpaiueouiuiuiui.wjfiles.localhost:18449",
        },
      },
    },
  });

  assert.deepEqual(
    sets.localOrigins,
    [
      "https://scp-wiki.wikijump.localhost:18449",
      "https://scp-wiki.wjfiles.localhost:18449",
      "https://scpaiueouiuiuiui.wikijump.localhost:18449",
      "https://scpaiueouiuiuiui.wjfiles.localhost:18449",
    ].sort(),
  );
  assert.deepEqual(sets.fileRouteOriginSets, [
    [
      "https://scp-wiki.wikijump.localhost:18449",
      "https://scp-wiki.wjfiles.localhost:18449",
    ],
    [
      "https://scpaiueouiuiuiui.wikijump.localhost:18449",
      "https://scpaiueouiuiuiui.wjfiles.localhost:18449",
    ],
  ]);
});

test("browser throttle receipt binds exact case-set public origins", () => {
  const base = {
    args: { mode: "candidate-case" },
    runId: "fixture-run",
    lock: { path: "/private/lock", owner: "fixture" },
    policy: { sha256: hash("a"), value: { policy_version: "fixture-v1" } },
    localOrigins: [],
    candidate: null,
  };
  const config = parityBrowserThrottleConfig({
    ...base,
    publicOrigins: ["https://www.youtube.com", "https://embed.acast.com"],
  });

  assert.deepEqual(config.case_set_public_origins, [
    "https://www.youtube.com",
    "https://embed.acast.com",
  ]);
  assert.throws(
    () =>
      parityBrowserThrottleConfig({
        ...base,
        publicOrigins: ["https://www.youtube.com/watch"],
      }),
    /exact HTTPS origins/u,
  );
  assert.equal(
    isParityBrowserPublicOrigin(
      "https://www.youtube.com/embed/video",
      "document",
      "GET",
      config.case_set_public_origins,
    ),
    true,
  );
  assert.equal(
    isParityBrowserPublicOrigin(
      "https://www.youtube.com/embed/video",
      "document",
      "POST",
      config.case_set_public_origins,
    ),
    false,
  );
  assert.equal(
    isParityBrowserPublicOrigin(
      "https://youtube.com/embed/video",
      "document",
      "GET",
      config.case_set_public_origins,
    ),
    false,
  );
});

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
  assert.deepEqual(fetchOptions, {
    url: "https://scp-wiki.wjfiles.localhost:18449/local--files/scp-9506/NFSI.png?download=true",
    maxRedirects: 0,
  });
  assert.deepEqual(fulfillment, { response });
});

test("candidate file routing follows only same-authority redirects on the sealed port", async () => {
  let handler;
  const context = {
    async route(_value, callback) {
      handler = callback;
    },
  };
  await installCandidateFilePortRoute(context, [
    "https://scp-wiki.wikijump.localhost:18449",
    "https://scp-wiki.wjfiles.localhost:18449",
  ]);

  const fetches = [];
  const finalResponse = { status: () => 200, headers: () => ({}) };
  const responses = [
    {
      status: () => 301,
      headers: () => ({ location: "/-/file/scp-9506/NFSI.png" }),
    },
    finalResponse,
  ];
  let fulfillment;
  await handler({
    request() {
      return {
        method: () => "GET",
        url: () =>
          "https://scp-wiki.wjfiles.localhost/local--files/scp-9506/NFSI.png",
      };
    },
    async fetch(options) {
      fetches.push(options);
      return responses.shift();
    },
    async fulfill(options) {
      fulfillment = options;
    },
  });

  assert.deepEqual(fetches, [
    {
      url: "https://scp-wiki.wjfiles.localhost:18449/local--files/scp-9506/NFSI.png",
      maxRedirects: 0,
    },
    {
      url: "https://scp-wiki.wjfiles.localhost:18449/-/file/scp-9506/NFSI.png",
      maxRedirects: 0,
    },
  ]);
  assert.deepEqual(fulfillment, { response: finalResponse });
});

test("candidate file routing returns public redirects to Chromium for gate enforcement", async () => {
  let handler;
  const context = {
    async route(_value, callback) {
      handler = callback;
    },
  };
  await installCandidateFilePortRoute(context, [
    "https://scp-wiki.wikijump.localhost:18449",
    "https://scp-wiki.wjfiles.localhost:18449",
  ]);

  const redirect = {
    status: () => 302,
    headers: () => ({ location: "https://cdn.example.invalid/asset.png" }),
  };
  let fetchCount = 0;
  let fulfillment;
  await handler({
    request() {
      return {
        method: () => "GET",
        url: () => "https://scp-wiki.wjfiles.localhost/local--files/a.png",
      };
    },
    async fetch() {
      fetchCount += 1;
      return redirect;
    },
    async fulfill(options) {
      fulfillment = options;
    },
  });

  assert.equal(fetchCount, 1);
  assert.deepEqual(fulfillment, { response: redirect });
});

test("candidate file routing preserves the live public admission before a Wikidot fallback redirect", async () => {
  let handler;
  const context = {
    async route(_value, callback) {
      handler = callback;
    },
  };
  let admissions = 0;
  await installCandidateFilePortRoute(
    context,
    [
      "https://scp-wiki.wikijump.localhost:18449",
      "https://scp-wiki.wjfiles.localhost:18449",
    ],
    {
      sourceRequestGate: {
        async acquire() {
          admissions += 1;
        },
      },
    },
  );

  const redirect = {
    status: () => 302,
    headers: () => ({
      location:
        "https://scp-wiki.wdfiles.com/local--files/theme%3Abasalt/basalt-theme-logo.svg",
    }),
  };
  let fulfillment;
  await handler({
    request() {
      return {
        method: () => "GET",
        resourceType: () => "image",
        url: () =>
          "https://scp-wiki.wjfiles.localhost/local--files/theme%3Abasalt/basalt-theme-logo.svg",
      };
    },
    async fetch() {
      return redirect;
    },
    async fulfill(options) {
      fulfillment = options;
    },
  });

  assert.equal(admissions, 1);
  assert.deepEqual(fulfillment, { response: redirect });
});

test("candidate file routing does not spend a source admission for unrelated public redirects", async () => {
  let handler;
  const context = {
    async route(_value, callback) {
      handler = callback;
    },
  };
  let admissions = 0;
  await installCandidateFilePortRoute(
    context,
    [
      "https://scp-wiki.wikijump.localhost:18449",
      "https://scp-wiki.wjfiles.localhost:18449",
    ],
    {
      sourceRequestGate: {
        async acquire() {
          admissions += 1;
        },
      },
    },
  );

  const redirect = {
    status: () => 302,
    headers: () => ({ location: "https://cdn.example.invalid/asset.png" }),
  };
  await handler({
    request() {
      return {
        method: () => "GET",
        resourceType: () => "image",
        url: () => "https://scp-wiki.wjfiles.localhost/local--files/a.png",
      };
    },
    async fetch() {
      return redirect;
    },
    async fulfill() {},
  });

  assert.equal(admissions, 0);
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
