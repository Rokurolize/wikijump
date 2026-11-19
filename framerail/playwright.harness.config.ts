import type { PlaywrightTestConfig } from "@playwright/test"

const config: PlaywrightTestConfig = {
  testDir: "./tests",
  testMatch: "filerollback-action-wiring.spec.ts",
  outputDir: "test-results/harness",
  workers: 1,
  reporter: "list"
}

export default config
