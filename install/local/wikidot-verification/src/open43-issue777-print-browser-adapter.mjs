const SELECTOR = 'a.wiki-standalone-button[href="javascript:;"]';
const POPUP_SELECTOR = 'a[href="javascript:;"][onclick*="window.print"]';
const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 2_000;
export const OPEN43_ISSUE777_PRINT_OPERATIONS = Object.freeze([
  "click",
  "enter",
  "space",
  "rapid_repeated_click",
  "sequential_repeated_click",
]);
const CAPTURE_CONTRACT = Object.freeze({
  slug: "issue777-print",
  theme_family: "candidate",
  presence_probes: Object.freeze([
    Object.freeze({
      id: "standalone-print",
      selector: SELECTOR,
      minimum_count: 1,
      require_rendered: true,
    }),
  ]),
});
const EXPECTED_POPUP_COUNTS = Object.freeze({
  click: 1,
  enter: 1,
  space: 0,
  rapid_repeated_click: 2,
  sequential_repeated_click: 2,
});

function installPrintProbe() {
  const state = {
    opens: [],
    prints: [],
    pagehide: 0,
  };
  Object.defineProperty(window, "__open43Issue777Print", {
    configurable: false,
    value: state,
  });
  const nativeOpen = typeof window.open === "function" ? window.open : null;
  Object.defineProperty(window, "open", {
    configurable: true,
    writable: true,
    value: (...args) => {
      state.opens.push({
        url: args[0] === undefined ? null : String(args[0]),
        target: args[1] === undefined ? null : String(args[1]),
      });
      if (!nativeOpen) return null;
      return nativeOpen.apply(window, args);
    },
  });
  Object.defineProperty(window, "print", {
    configurable: true,
    writable: true,
    value: (...args) => {
      const control = document.querySelector(POPUP_SELECTOR);
      state.prints.push({
        url: location.href,
        history_length: history.length,
        focused_control: document.activeElement === control,
        argument_count: args.length,
      });
    },
  });
  window.addEventListener("pagehide", () => {
    state.pagehide += 1;
  });
}

async function openerState(page) {
  return await page.evaluate((selector) => {
    const control = document.querySelector(selector);
    const probe = window.__open43Issue777Print;
    return {
      url: location.href,
      path: location.pathname,
      history_length: history.length,
      standalone_print_count: document.querySelectorAll(selector).length,
      focused_control: document.activeElement === control,
      aria_busy: control?.getAttribute("aria-busy") === "true",
      open_count: probe?.opens.length ?? -1,
      print_call_count: probe?.prints.length ?? -1,
      opens: probe?.opens ?? [],
      source_disclosure:
        location.pathname.endsWith("/source") ||
        document.body?.innerText.includes("[[button print") === true,
    };
  }, SELECTOR);
}

async function popupState(popup) {
  return await popup.evaluate((selector) => {
    const control = document.querySelector(selector);
    const probe = window.__open43Issue777Print;
    return {
      url: location.href,
      path: location.pathname,
      history_length: history.length,
      body_id: document.body?.id ?? null,
      body_class: document.body?.className ?? null,
      print_control_count: document.querySelectorAll(selector).length,
      rendered:
        control !== null &&
        getComputedStyle(control).display !== "none" &&
        getComputedStyle(control).visibility !== "hidden",
      focused_control: document.activeElement === control,
      aria_busy: control?.getAttribute("aria-busy"),
      control_href: control?.getAttribute("href") ?? null,
      control_onclick: control?.getAttribute("onclick") ?? null,
      control_outer_html: control?.outerHTML ?? null,
      parent_outer_html: control?.parentElement?.outerHTML ?? null,
      print_call_count: probe?.prints.length ?? -1,
      prints: probe?.prints ?? [],
    };
  }, POPUP_SELECTOR);
}

export class Open43Issue777PrintBrowserAdapter {
  #browserContexts;
  #context = null;

  constructor({ browserContexts }) {
    this.#browserContexts = browserContexts;
  }

  async #candidateContext() {
    if (this.#context === null) {
      const browser = await this.#browserContexts.newCandidateContext({
        viewport: VIEWPORT,
      });
      await browser.context.addInitScript(installPrintProbe);
      this.#context = browser.context;
    }
    return this.#context;
  }

  async #observePopup(popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: TIMEOUT_MS });
    const control = popup.locator(POPUP_SELECTOR);
    if ((await control.count()) !== 1) {
      throw new Error("issue 777 printer-friendly view did not serve one print control");
    }
    const before = await popupState(popup);
    await control.focus();
    const focused = await popupState(popup);
    await this.#activateUntil(
      () => control.click({ noWaitAfter: true }),
      async () => (await popupState(popup)).print_call_count > 0,
    );
    const after = await popupState(popup);
    return { before, focused, after };
  }

  async #activateUntil(activate, ready) {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await ready()) return;
      await activate();
      const waitUntil = Date.now() + 500;
      while (Date.now() < waitUntil) {
        if (await ready()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    throw new Error("issue 777 activation did not take effect before the deadline");
  }

  async #waitForOpened(opened, count) {
    const start = Date.now();
    while (opened.length < count) {
      if (Date.now() - start > TIMEOUT_MS) {
        throw new Error(
          `issue 777 expected ${count} child windows, observed ${opened.length}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async #operation(pageUrl, mode) {
    const context = await this.#candidateContext();
    const page = await context.newPage();
    const opened = [];
    const onPage = (popup) => opened.push(popup);
    try {
      await page.goto(pageUrl, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUT_MS,
      });
      const control = page.locator(SELECTOR);
      if ((await control.count()) !== 1) {
        throw new Error("issue 777 did not serve exactly one print control");
      }
      await control.focus();
      await page.evaluate(() => {
        window.__open43Issue777Print.opens.length = 0;
        window.__open43Issue777Print.prints.length = 0;
      });
      const before = await openerState(page);
      let mutationRequestCount = 0;
      const onRequest = (request) => {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
          mutationRequestCount += 1;
        }
      };
      page.on("request", onRequest);
      page.on("popup", onPage);
      try {
        const expectedCount = EXPECTED_POPUP_COUNTS[mode];
        const click = () => control.click({ noWaitAfter: true });
        if (mode === "click") {
          await this.#activateUntil(click, () => opened.length >= 1);
        } else if (mode === "enter") {
          await this.#activateUntil(
            () => control.press("Enter", { noWaitAfter: true }),
            () => opened.length >= 1,
          );
        } else if (mode === "space") {
          await control.press(" ", { noWaitAfter: true });
          await page.waitForTimeout(250);
        } else if (mode === "rapid_repeated_click") {
          await this.#activateUntil(click, () => opened.length >= 1);
          await click();
        } else if (mode === "sequential_repeated_click") {
          await this.#activateUntil(click, () => opened.length >= 1);
          await opened[0].waitForLoadState("load", { timeout: TIMEOUT_MS });
          await click();
        } else {
          throw new Error(`unknown issue 777 print operation: ${mode}`);
        }
        if (expectedCount > 0) await this.#waitForOpened(opened, expectedCount);
        const during = await openerState(page);
        const popupObservations = [];
        for (const popup of opened.slice(0, expectedCount)) {
          popupObservations.push(await this.#observePopup(popup));
        }
        const after = await openerState(page);
        return {
          before,
          during,
          after,
          popup_observations: popupObservations,
          popup_count: opened.length,
          mutation_request_count: mutationRequestCount,
        };
      } finally {
        page.off("popup", onPage);
        page.off("request", onRequest);
        for (const popup of opened) {
          await popup
            .close({ runBeforeUnload: false, timeout: CLOSE_TIMEOUT_MS })
            .catch(() => undefined);
        }
      }
    } finally {
      await page
        .close({ runBeforeUnload: false, timeout: CLOSE_TIMEOUT_MS })
        .catch(() => undefined);
    }
  }

  async run({ pageUrl }) {
    await this.#browserContexts.setActiveFixture(
      "A777_BROWSER_PRINT_LIFECYCLE",
    );
    const context = await this.#candidateContext();
    const page = await context.newPage();
    let initial;
    try {
      const capture = await this.#browserContexts.captureCandidateObservation({
        context,
        page,
        url: pageUrl,
        label: "A777_BROWSER_PRINT_LIFECYCLE",
        index: 0,
        contract: CAPTURE_CONTRACT,
        viewport: VIEWPORT,
        timeoutMs: TIMEOUT_MS,
        settleMs: 0,
        onPhase: () =>
          this.#browserContexts.setActiveFixture(
            "A777_BROWSER_PRINT_LIFECYCLE",
          ),
      });
      initial = { capture, state: await openerState(page) };
    } finally {
      await page
        .close({ runBeforeUnload: false, timeout: CLOSE_TIMEOUT_MS })
        .catch(() => undefined);
    }
    const operations = Object.fromEntries(
      await Promise.all(
        OPEN43_ISSUE777_PRINT_OPERATIONS.map(async (mode) => [
          mode,
          await this.#operation(pageUrl, mode),
        ]),
      ),
    );
    return { initial, operations };
  }
}
