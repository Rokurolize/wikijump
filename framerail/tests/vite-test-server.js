import { createServer } from "vite"

/**
 * Creates the Vite SSR server used by Node unit tests.
 *
 * The unit runner synchronizes SvelteKit once before workers start and
 * test sources are immutable for the lifetime of the run, so filesystem
 * watching only introduces cross-worker invalidation of the shared
 * generated tree.
 */
export const createTestViteServer = async () => {
  const server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: {
      middlewareMode: true,
      watch: null
    }
  })

  // SvelteKit 3 serves requests through the SSR environment's module runner,
  // which keeps its own module instances. Route ssrLoadModule through the same
  // runner so tests that patch a module (e.g. the Deepwell client) affect the
  // instance the request handlers use.
  server.ssrLoadModule = (url) => server.environments.ssr.runner.import(url)
  return server
}
