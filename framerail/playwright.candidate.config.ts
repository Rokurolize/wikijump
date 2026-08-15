import sharedConfig from "./playwright.config.ts"

const { webServer: _mockFixtureServer, ...candidateConfig } = sharedConfig
const outputDir = process.env.OPEN43_MEDIA_OUTPUT_DIR

export default {
  ...candidateConfig,
  testMatch: "**/open43-media-files-candidate.spec.ts",
  outputDir: outputDir ? `${outputDir}/playwright` : undefined,
  reporter: "line"
}
