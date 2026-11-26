import type { PlaywrightTestConfig } from "@playwright/test"

const config: PlaywrightTestConfig = {
  testDir: "./tests",
  testMatch: "files-pane-restore-race.spec.ts",
  outputDir: "test-results/files-pane-restore-race",
  workers: 1,
  reporter: "list"
}

export default config
