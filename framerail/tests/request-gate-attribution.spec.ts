import { expect, test } from "@playwright/test"

import {
  createBrowserRequestGate,
  installBrowserRequestGate,
  isWikidotCapturePublicOrigin
} from "../../install/local/wikidot-verification/src/browser-request-gate.mjs"
import { captureBrowserParityObservation } from "../../install/local/wikidot-verification/src/standing-browser-parity-observation.mjs"

test("an intentional request-gate abort is sealed separately from organic page failures", async ({
  context,
  page
}, testInfo) => {
  const gate = createBrowserRequestGate({ intervalMs: 4_000 })
  const attribution = await installBrowserRequestGate(context, {
    gate,
    publicOriginPredicate: isWikidotCapturePublicOrigin
  })
  const observation = await captureBrowserParityObservation({
    context,
    page,
    url: "https://scp-wiki.wikidot.com/gate-attribution-fixture",
    label: "live",
    index: 0,
    outputDir: testInfo.outputDir,
    contract: null,
    viewport: { width: 800, height: 600 },
    timeoutMs: 10_000,
    settleMs: 0,
    requestGateAttribution: attribution,
    navigate: async ({ page: target }) => {
      await target.setContent(
        '<main id="page-content">fixture</main><script src="https://cdn.onesignal.com/sdks/OneSignalSDK.js"></script>',
        { waitUntil: "load" }
      )
      return { status: 200 }
    }
  })

  expect(observation.failures).toEqual([])
  expect(observation.request_gate_aborts).toEqual([
    {
      kind: "request_gate_abort",
      url: "https://cdn.onesignal.com/sdks/OneSignalSDK.js",
      resource_type: "script",
      error: "net::ERR_BLOCKED_BY_CLIENT.Inspector",
      decision: "unsupported_public_origin_resource_type",
      abort_reason: "blockedbyclient"
    }
  ])
  expect(gate.snapshot()).toMatchObject({
    public_requests: 0,
    unsupported_requests_blocked: 1,
    grants: []
  })
})
