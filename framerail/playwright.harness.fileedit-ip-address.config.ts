import type { PlaywrightTestConfig } from "@playwright/test"

const config: PlaywrightTestConfig = {
  testDir: "./tests",
  testMatch: "fileedit-ip-address.spec.ts",
  outputDir: "test-results/fileedit-ip-address",
  workers: 1,
  reporter: "list"
}

export default config
