import type { PlaywrightTestConfig } from "@playwright/test"

const config: PlaywrightTestConfig = {
  webServer: {
    command: "pnpm build && FRAMERAIL_ENV=local pnpm preview",
    port: 4173
  }
}

export default config
