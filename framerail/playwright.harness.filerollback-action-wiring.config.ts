import type { PlaywrightTestConfig } from "@playwright/test"

const config: PlaywrightTestConfig = {
  testDir: "./tests",
  testMatch: "filerollback-action-wiring.spec.ts",
  outputDir: "test-results/filerollback-action-wiring",
  workers: 1,
  reporter: "list"
}

export default config
