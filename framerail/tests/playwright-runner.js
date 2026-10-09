import { rmSync } from "node:fs"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"

const playwrightCli = fileURLToPath(import.meta.resolve("@playwright/test/cli"))

const allocatePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Failed to allocate a Playwright port"))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })

const appPort = await allocatePort()
const fixturePort = await allocatePort()
const browserSupportHttps = process.argv.includes("playwright.browser-support.config.ts")
const cleanupBrowserSupportHttps = () => {
  if (browserSupportHttps) {
    rmSync("/tmp/wikijump-playwright-tls-2242", { recursive: true, force: true })
  }
}
const child = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
  env: {
    ...process.env,
    PLAYWRIGHT_APP_PORT: String(appPort),
    PLAYWRIGHT_FIXTURE_PORT: String(fixturePort),
    PLAYWRIGHT_HTTPS_APP_PORT: "4373"
  },
  stdio: "inherit"
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => child.kill(signal))
}

child.once("error", (error) => {
  cleanupBrowserSupportHttps()
  console.error(error)
  process.exitCode = 1
})
child.once("exit", (code, signal) => {
  cleanupBrowserSupportHttps()
  process.exitCode = signal ? 1 : (code ?? 1)
})
