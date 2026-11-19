import type { PlaywrightTestConfig } from "@playwright/test"

const config: PlaywrightTestConfig = {
  testDir: "./tests",
  testMatch: "file-history-stale-response.spec.ts",
  workers: 1,
  reporter: "list"
}

export default config
