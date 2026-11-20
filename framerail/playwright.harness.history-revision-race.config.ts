import type { PlaywrightTestConfig } from "@playwright/test"

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE

const config: PlaywrightTestConfig = {
  testDir: "./tests",
  testMatch: "history-revision-race.spec.ts",
  outputDir: "test-results/history-revision-race",
  workers: 1,
  reporter: "list",
  use: executablePath ? { launchOptions: { executablePath } } : {}
}

export default config
