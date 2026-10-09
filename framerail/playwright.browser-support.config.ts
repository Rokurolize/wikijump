import { devices, type PlaywrightTestConfig } from "@playwright/test"

import baseConfig from "./playwright.config"

const withBaseUse = (device: (typeof devices)[keyof typeof devices]) => ({
  ...(baseConfig.use ?? {}),
  ...device
})

const config: PlaywrightTestConfig = {
  ...baseConfig,
  testMatch:
    "**/{auth-accessible-names,browser-support,forum-start-routes,inline-link-whitespace,module-accessible-names,printer-friendly-print-toolbar}.spec.ts",
  projects: [
    {
      name: "chromium",
      use: withBaseUse(devices["Desktop Chrome"])
    },
    {
      name: "firefox",
      use: withBaseUse(devices["Desktop Firefox"])
    },
    {
      name: "webkit",
      use: withBaseUse(devices["Desktop Safari"])
    },
    {
      name: "mobile-chromium",
      use: withBaseUse(devices["Pixel 7"])
    }
  ]
}

export default config
