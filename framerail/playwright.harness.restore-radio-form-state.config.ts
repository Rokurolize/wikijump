import type { PlaywrightTestConfig } from "@playwright/test"

const config: PlaywrightTestConfig = {
  testDir: "./tests",
  testMatch: "restore-radio-form-state.spec.ts",
  outputDir: "test-results/restore-radio-form-state",
  workers: 1,
  reporter: "list"
}

export default config
