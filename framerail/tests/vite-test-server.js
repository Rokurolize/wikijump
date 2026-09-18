import { createServer } from "vite"

/**
 * Creates the Vite SSR server used by Node unit tests.
 *
 * The unit runner synchronizes SvelteKit once before workers start and
 * test sources are immutable for the lifetime of the run, so filesystem
 * watching only introduces cross-worker invalidation of the shared
 * generated tree.
 */
export const createTestViteServer = () => {
  return createServer({
    appType: "custom",
    logLevel: "silent",
    server: {
      middlewareMode: true,
      watch: null
    }
  })
}
