import { expect, test as base } from "@playwright/test"

const isLoopbackHost = (hostname: string) =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname.endsWith(".localhost")

const STATIC_EXTERNAL_TYPES = new Set(["stylesheet", "font", "image"])

export const test = base.extend({
  context: async ({ context }, use) => {
    if (process.env.WIKIJUMP_TEST_DEBUG_BROWSER === "1") {
      context.on("page", (page) => {
        page.on("pageerror", (error) =>
          console.error(`[browser pageerror] ${error.stack ?? error.message}`)
        )
        page.on("console", (message) => {
          if (message.type() === "error") {
            console.error(`[browser console] ${message.text()}`)
          }
        })
        page.on("requestfailed", (request) =>
          console.error(
            `[browser requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`
          )
        )
      })
    }
    await context.route("**/*", async (route) => {
      const request = route.request()
      let url: URL
      try {
        url = new URL(request.url())
      } catch {
        await route.abort("blockedbyclient")
        return
      }

      if (isLoopbackHost(url.hostname)) {
        await route.continue()
        return
      }

      if (STATIC_EXTERNAL_TYPES.has(request.resourceType())) {
        if (process.env.WIKIJUMP_TEST_DEBUG_BROWSER === "1") {
          console.error(`[browser fixture] ${request.resourceType()} ${request.url()}`)
        }
        const contentType =
          request.resourceType() === "stylesheet"
            ? "text/css; charset=utf-8"
            : request.resourceType() === "font"
              ? "font/woff2"
              : "image/gif"
        await route.fulfill({ status: 200, contentType, body: "" })
        return
      }

      if (process.env.WIKIJUMP_TEST_DEBUG_BROWSER === "1") {
        console.error(`[browser blocked] ${request.resourceType()} ${request.url()}`)
      }
      await route.abort("blockedbyclient")
    })
    await use(context)
  }
})

export { expect }
export type { APIRequestContext, APIResponse, Page, Route } from "@playwright/test"

export const waitForSvelteDelegatedHandler = (
  page: import("@playwright/test").Page,
  selector: string,
  eventName = "click"
) =>
  page.waitForFunction(
    ({ selector, eventName }) => {
      const element = document.querySelector(selector)
      if (!element) return false
      const eventsSymbol = Object.getOwnPropertySymbols(element).find(
        (symbol) => symbol.description === "events"
      )
      if (!eventsSymbol) return false
      const handlers = (element as unknown as Record<symbol, Record<string, unknown>>)[
        eventsSymbol
      ]
      return typeof handlers?.[eventName] === "function"
    },
    { selector, eventName }
  )

export const installNativeEventListenerProbe = (page: import("@playwright/test").Page) =>
  page.addInitScript(() => {
    const ready = Symbol.for("wikijump.test.native-listeners")
    const descriptor = Object.getOwnPropertyDescriptor(
      EventTarget.prototype,
      "addEventListener"
    )
    if (typeof descriptor?.value !== "function") {
      throw new Error("EventTarget.addEventListener is unavailable")
    }
    const original = descriptor.value as EventTarget["addEventListener"]
    EventTarget.prototype.addEventListener = function (...args) {
      const type = args[0]
      if (typeof type === "string") {
        const target = this as EventTarget & Record<symbol, Record<string, number>>
        const listeners = (target[ready] ??= {})
        listeners[type] = (listeners[type] ?? 0) + 1
      }
      return Reflect.apply(original, this, args)
    }
  })

export const waitForNativeEventListener = (
  page: import("@playwright/test").Page,
  selector: string | null,
  eventName: string
) =>
  page.waitForFunction(
    ({ selector, eventName }) => {
      const target = selector ? document.querySelector(selector) : document
      if (!target) return false
      const listeners = (
        target as unknown as EventTarget & Record<symbol, Record<string, number>>
      )[Symbol.for("wikijump.test.native-listeners")]
      return (listeners?.[eventName] ?? 0) > 0
    },
    { selector, eventName }
  )
