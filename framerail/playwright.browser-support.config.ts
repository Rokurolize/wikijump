import { devices, type PlaywrightTestConfig } from "@playwright/test"

import baseConfig from "./playwright.config"

const withOfflineEgress = (device: (typeof devices)[keyof typeof devices]) => ({
  ...(baseConfig.use ?? {}),
  ...device,
  launchOptions: baseConfig.use?.launchOptions
})

const config: PlaywrightTestConfig = {
  ...baseConfig,
  testMatch: "**/browser-support.spec.ts",
  projects: [
    {
      name: "chromium",
      use: withOfflineEgress(devices["Desktop Chrome"])
    },
    {
      name: "firefox",
      use: withOfflineEgress(devices["Desktop Firefox"])
    },
    {
      name: "webkit",
      use: withOfflineEgress(devices["Desktop Safari"])
    },
    {
      name: "mobile-chromium",
      use: withOfflineEgress(devices["Pixel 7"])
    }
  ]
}

export default config
