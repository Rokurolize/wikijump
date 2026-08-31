import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_REQUEST_INTERVAL_MS,
  acquireBrowserCaptureLock,
  createPersistentBrowserRequestGate,
  isWikidotCapturePublicOrigin,
  installBrowserRequestGate,
} from "./browser-request-gate.mjs";
import { startCaptureEgressProxy } from "./capture-egress-proxy.mjs";
import {
  requireExactHttpsOrigins,
  readJsonObject,
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sealJsonNoReplace,
  sha256File,
} from "./standing-browser-parity-util.mjs";

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PARITY_BROWSER_ROOT = path.resolve(
  SOURCE_DIR,
  "../../../..",
  "framerail",
);
const THROTTLE_CONFIG_SCHEMA = "wikijump.standing_browser_throttle_config.v1";
const MAX_CANDIDATE_FILE_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function parityBrowserExecutionMode(mode) {
  if (mode === "live-reference") return "live";
  if (mode === "candidate" || mode === "candidate-case") return "candidate";
  throw new Error(`unsupported parity browser mode: ${mode}`);
}

export function parityBrowserRequestIntervalMs(mode) {
  return parityBrowserExecutionMode(mode) === "live"
    ? DEFAULT_REQUEST_INTERVAL_MS
    : 0;
}

function requirePlaywright(browserRoot) {
  const requireFromRoot = createRequire(path.join(browserRoot, "package.json"));
  try {
    return requireFromRoot("playwright");
  } catch (firstError) {
    try {
      return requireFromRoot("@playwright/test");
    } catch (secondError) {
      throw new Error(
        `could not load playwright from ${browserRoot}; pass --browser-root pointing at an installed browser adapter (${firstError.message}; ${secondError.message})`,
      );
    }
  }
}

async function resolveBrowserExecutable(chromium, browserExecutable) {
  const executable = await fs.realpath(
    browserExecutable ?? chromium.executablePath(),
  );
  const stat = await fs.lstat(executable);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("browser executable must resolve to a regular file");
  }
  return executable;
}

function localConnectLookup(address, allowedOrigins, fallback = dns.lookup) {
  const family = net.isIP(address);
  if (!family)
    throw new Error(
      "candidate local connect address must be a literal IP address",
    );
  const hostnames = new Set(
    allowedOrigins.map((origin) => new URL(origin).hostname.toLowerCase()),
  );
  return async (hostname, options) => {
    if (hostnames.has(String(hostname).toLowerCase())) {
      return [{ address, family }];
    }
    return await fallback(hostname, options);
  };
}

export async function installCandidateFilePortRoute(
  context,
  localOrigins,
  { sourceRequestGate = null } = {},
) {
  if (!Array.isArray(localOrigins) || localOrigins.length !== 2) {
    throw new Error(
      "candidate local origins must contain exactly page and file origins",
    );
  }
  const origins = localOrigins.map((origin) => new URL(origin));
  const page = origins.find((origin) =>
    origin.hostname.endsWith(".wikijump.localhost"),
  );
  const files = origins.find((origin) =>
    origin.hostname.endsWith(".wjfiles.localhost"),
  );
  if (!page || !files) {
    throw new Error(
      "candidate local origins must contain page and file origins",
    );
  }
  const pageSite = page.hostname.slice(0, -".wikijump.localhost".length);
  const filesSite = files.hostname.slice(0, -".wjfiles.localhost".length);
  if (!pageSite || pageSite !== filesSite) {
    throw new Error(
      "candidate page and file origins must use the same site slug",
    );
  }
  if (
    page.protocol !== "https:" ||
    files.protocol !== "https:" ||
    !page.port ||
    page.port === "443" ||
    files.port !== page.port
  ) {
    throw new Error(
      "candidate page and file origins must use the same explicit non-443 port",
    );
  }
  const canonicalFilesOrigin = `https://${files.hostname}`;
  const fileRouteHandler = async (route) => {
    const requestUrl = new URL(route.request().url());
    if (
      requestUrl.origin !== canonicalFilesOrigin &&
      requestUrl.origin !== files.origin
    ) {
      await route.continue();
      return;
    }
    if (requestUrl.origin === canonicalFilesOrigin) requestUrl.port = files.port;
    let response;
    for (let redirects = 0; ; redirects += 1) {
      response = await route.fetch({
        url: requestUrl.href,
        maxRedirects: 0,
      });
      if (
        route.request().method?.() !== "GET" ||
        !REDIRECT_STATUSES.has(response.status())
      ) {
        break;
      }
      const location = response.headers().location;
      if (!location) break;
      const redirectUrl = new URL(location, requestUrl);
      if (
        redirectUrl.username ||
        redirectUrl.password ||
        !new Set([canonicalFilesOrigin, files.origin]).has(redirectUrl.origin)
      ) {
        break;
      }
      if (redirects >= MAX_CANDIDATE_FILE_REDIRECTS) {
        throw new Error("candidate file redirect limit exceeded");
      }
      redirectUrl.port = files.port;
      requestUrl.href = redirectUrl.href;
    }
    if (sourceRequestGate !== null && route.request().method?.() === "GET") {
      const sourcePath = new URL(route.request().url()).pathname;
      const location = REDIRECT_STATUSES.has(response.status())
        ? response.headers().location
        : null;
      const redirectUrl = location ? new URL(location, requestUrl) : null;
      const returnsGatedPublicRedirect =
        redirectUrl !== null &&
        !new Set([canonicalFilesOrigin, files.origin]).has(
          redirectUrl.origin,
        ) &&
        isWikidotCapturePublicOrigin(
          redirectUrl,
          route.request().resourceType?.() ?? "other",
          "GET",
        );

      if (sourcePath.startsWith("/local--files/")) {
        // Wikidot-rendered page-owned file URLs first hit
        // <site>.wikidot.com/local--files/... and then the corresponding
        // wdfiles authority. The local candidate mirror collapses those public
        // stages into one exempt wjfiles request. Preserve the two source-side
        // admissions before exposing a mirror hit to Chromium. If the mirror
        // falls back to a public redirect, only synthesize the first stage; the
        // redirected public request consumes the second admission normally.
        await sourceRequestGate.acquire();
        if (!returnsGatedPublicRedirect) await sourceRequestGate.acquire();
      } else if (
        sourcePath.startsWith("/local--code/") &&
        !returnsGatedPublicRedirect
      ) {
        // Authored/generated local-code URLs are direct wdfiles requests on
        // Wikidot. A successful local mirror therefore represents one public
        // source request. A fallback public redirect is already gated normally.
        await sourceRequestGate.acquire();
      }
    }
    await route.fulfill({ response });
  };
  // Framerail can emit either Wikidot's canonical no-port file authority or
  // the candidate's already-localized sealed-port authority. Both represent
  // the same source-owned file request and must pass through the timing shim;
  // otherwise already-localized assets bypass the source request gate and can
  // complete before Wikidot's DOMContentLoaded-immediate observation.
  await context.route(`${canonicalFilesOrigin}/**`, fileRouteHandler);
  await context.route(`${files.origin}/**`, fileRouteHandler);
  return true;
}

export function candidateLocalOriginSets(candidate) {
  const endpointOrigins =
    candidate?.candidate?.endpoint?.allowed_origin_set ?? [];
  const siteOrigins = candidate?.candidate?.site_origins;
  const fileRouteOriginSets =
    siteOrigins && Object.keys(siteOrigins).length > 0
      ? Object.values(siteOrigins).map(({ page, files }) => [page, files])
      : endpointOrigins.length > 0
        ? [endpointOrigins]
        : [];
  const localOrigins = [
    ...new Set([...endpointOrigins, ...fileRouteOriginSets.flat()]),
  ].sort();
  return { localOrigins, fileRouteOriginSets };
}

export function parityBrowserThrottleConfig({
  args,
  runId,
  lock,
  policy,
  localOrigins,
  candidate,
  credentialPolicy = "none",
  publicOrigins = [],
}) {
  const executionMode = parityBrowserExecutionMode(args.mode);
  const caseSetPublicOrigins = requireExactHttpsOrigins(
    publicOrigins,
    "browser public origins",
  );
  let credentials = "none";
  if (credentialPolicy !== "none") {
    const value = requirePlainObject(
      credentialPolicy,
      "browser credential policy",
    );
    if (
      value.mode !== "private-actor-storage-states" ||
      !Number.isSafeInteger(value.storage_state_count) ||
      value.storage_state_count < 1 ||
      JSON.stringify(Object.keys(value).sort()) !==
        JSON.stringify([
          "mode",
          "private_input_identity_sha256",
          "storage_state_count",
        ])
    ) {
      throw new Error(
        "browser credential policy must bind a private actor storage-state count",
      );
    }
    credentials = {
      mode: value.mode,
      storage_state_count: value.storage_state_count,
      private_input_identity_sha256: requireSha256(
        value.private_input_identity_sha256,
        "browser credential policy private input identity SHA-256",
      ),
    };
  }
  return {
    schema: THROTTLE_CONFIG_SCHEMA,
    status: "sealed_before_browser_request",
    run_id: runId,
    mode: args.mode,
    execution_mode: executionMode,
    interval_ms: parityBrowserRequestIntervalMs(args.mode),
    browser_capture_lock: { path: lock.path, owner: lock.owner },
    live_completion_policy: {
      sha256: policy.sha256,
      policy_version: policy.value.policy_version,
    },
    local_context_exempt_origins: localOrigins,
    candidate_endpoint: candidate ?? null,
    ...(caseSetPublicOrigins.length === 0
      ? {
          public_request_policy:
            "Wikidot-family requests and non-Wikidot stylesheets, fonts, and images are admitted by the shared persistent gate; scripts and fetches from other public origins are aborted before admission",
          public_origin_policy:
            "HTTP(S) Wikidot page/resource hosts (wikidot.com and its subdomains, wdfiles.com resources, /v-- static assets on a CloudFront host, and exact HTTPS GET interwiki.scpwiki.com styleFrame/interwikiFrame documents plus interwiki/resizeIframe scripts) are gated; non-Wikidot stylesheet, font, and image dependencies are gated by resource type; other public hosts are aborted before admission",
        }
      : {
          case_set_public_origins: caseSetPublicOrigins,
          public_request_policy:
            "Wikidot-family requests, exact case-set GET origins, and non-Wikidot stylesheets, fonts, and images are admitted by the shared persistent gate; scripts and fetches from other public origins are aborted before admission",
          public_origin_policy:
            "HTTP(S) Wikidot page/resource hosts (wikidot.com and its subdomains, wdfiles.com resources, /v-- static assets on a CloudFront host, and exact HTTPS GET interwiki.scpwiki.com styleFrame/interwikiFrame documents plus interwiki/resizeIframe scripts) and exact case-set HTTPS GET origins are gated; non-Wikidot stylesheet, font, and image dependencies are gated by resource type; other public hosts are aborted before admission",
        }),
    service_workers: "block",
    web_sockets: "blocked_without_network_connection",
    credentials,
  };
}

export function isParityBrowserPublicOrigin(
  value,
  resourceType,
  method,
  publicOrigins = [],
) {
  const url = value instanceof URL ? value : new URL(value);
  return (
    isWikidotCapturePublicOrigin(url, resourceType, method) ||
    (method === "GET" && publicOrigins.includes(url.origin))
  );
}

export async function createParityBrowserControls({
  args,
  outputDir,
  policy,
  candidate,
  credentialPolicy = "none",
  publicOrigins = [],
  resume = false,
}) {
  const runId = randomUUID();
  const executionMode = parityBrowserExecutionMode(args.mode);
  // Live-reference capture shares one host-global admission state. A caller
  // must not be able to select a second lock/state pair from the public CLI.
  const lock = await acquireBrowserCaptureLock({ runId });
  let gate = null;
  let proxy = null;
  try {
    gate = await createPersistentBrowserRequestGate({
      statePath: lock.statePath,
      intervalMs: parityBrowserRequestIntervalMs(args.mode),
    });
    const { localOrigins, fileRouteOriginSets } =
      candidateLocalOriginSets(candidate);
    const caseSetPublicOrigins = requireExactHttpsOrigins(
      publicOrigins,
      "browser public origins",
    );
    const configPath = path.join(outputDir, "throttle-config-receipt.json");
    let configRunId = runId;
    let configLock = lock;
    if (resume) {
      const existing = await readJsonObject(configPath, "existing throttle config");
      configRunId = requireNonEmptyString(existing.run_id, "existing throttle config run_id");
      configLock = requirePlainObject(existing.browser_capture_lock, "existing throttle config browser_capture_lock");
    }
    const configSeal = await sealJsonNoReplace(
      configPath,
      parityBrowserThrottleConfig({
        args,
        runId: configRunId,
        lock: configLock,
        policy,
        localOrigins,
        candidate: candidate?.candidate.endpoint ?? null,
        credentialPolicy,
        publicOrigins: caseSetPublicOrigins,
      }),
    );
    proxy = await startCaptureEgressProxy({
      allowedLocalOrigins: localOrigins,
      requestTimeoutMs: args.timeoutMs,
      ...(candidate
        ? {
            lookup: localConnectLookup(
              candidate.candidate.endpoint.local_connect_address,
              localOrigins,
            ),
          }
        : {}),
    });
    return {
      gate,
      proxy,
      lock,
      runId,
      configPath,
      configSha256: configSeal.sha256,
      localOrigins,
      fileRouteOriginSets,
      publicOrigins: caseSetPublicOrigins,
      async close() {
        let failure = null;
        await proxy?.close().catch((error) => {
          failure ??= error;
        });
        await gate.flush().catch((error) => {
          failure ??= error;
        });
        const finalGateSnapshot = failure
          ? null
          : {
              ...gate.snapshot(),
              execution_mode: executionMode,
              config_sha256: configSeal.sha256,
            };
        if (!failure) {
          await lock.confirmState().catch((error) => {
            failure ??= error;
          });
        }
        if (!failure) {
          await lock.release().catch((error) => {
            failure ??= error;
          });
        }
        if (failure) throw failure;
        return finalGateSnapshot;
      },
      setActiveFixture(fixtureId) {
        gate.setActiveFixture(fixtureId);
      },
    };
  } catch (error) {
    await proxy?.close().catch(() => undefined);
    if (gate) {
      const flushed = await gate
        .flush()
        .then(() => true)
        .catch(() => false);
      if (flushed) {
        await lock.confirmState().catch(() => undefined);
        await lock.release().catch(() => undefined);
      }
    }
    throw error;
  }
}

export async function launchParityBrowser({
  browserRoot,
  browserExecutable,
  controls,
  local,
  storageState = null,
  viewport,
}) {
  const { chromium } = requirePlaywright(browserRoot);
  const executable = await resolveBrowserExecutable(
    chromium,
    browserExecutable,
  );
  const browser = await chromium.launch({ executablePath: executable });
  let context = null;
  try {
    context = await browser.newContext({
      ignoreHTTPSErrors: local,
      viewport,
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
      serviceWorkers: "block",
      proxy: { server: controls.proxy.url, bypass: "<-loopback>" },
      ...(storageState === null ? {} : { storageState }),
    });
    const requestGateAttribution = await installBrowserRequestGate(context, {
      gate: controls.gate,
      exemptOrigins: local ? controls.localOrigins : [],
      publicOriginPredicate: (url, resourceType, method) =>
        isParityBrowserPublicOrigin(
          url,
          resourceType,
          method,
          controls.publicOrigins,
        ),
    });
    if (local) {
      for (const originSet of controls.fileRouteOriginSets) {
        await installCandidateFilePortRoute(context, originSet, {
          sourceRequestGate: controls.gate,
        });
      }
    }
    return {
      browser,
      context,
      requestGateAttribution,
      environment: {
        engine: "chromium",
        version: await browser.version(),
        executable_sha256: await sha256File(executable),
      },
      async close() {
        await closeParityBrowserResources(context, browser);
      },
    };
  } catch (error) {
    try {
      await closeParityBrowserResources(context, browser);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "browser initialization and cleanup both failed",
      );
    }
    throw error;
  }
}

export async function closeParityBrowserResources(context, browser) {
  const failures = [];
  if (context !== null) {
    await context.close().catch((error) => failures.push(error));
  }
  await browser.close().catch((error) => failures.push(error));
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "parity browser resources failed to close",
    );
  }
}
