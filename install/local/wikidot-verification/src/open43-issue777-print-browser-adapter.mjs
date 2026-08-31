const SELECTOR = 'a.wiki-standalone-button[href="javascript:;"]';
const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const TIMEOUT_MS = 300_000;
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

function installPrintProbe() {
  const calls = [];
  const pending = [];
  const probe = {
    calls,
    pending,
    reset() {
      calls.length = 0;
      while (pending.length > 0) pending.shift()?.();
    },
    release() {
      pending.shift()?.();
    },
  };
  Object.defineProperty(window, "__open43Issue777Print", {
    configurable: false,
    value: probe,
  });
  Object.defineProperty(window, "print", {
    configurable: true,
    value: () =>
      new Promise((resolve) => {
        const control = document.querySelector(
          'a.wiki-standalone-button[href="javascript:;"]',
        );
        calls.push({
          url: location.href,
          history_length: history.length,
          focused_control: document.activeElement === control,
        });
        pending.push(resolve);
      }),
  });
}

async function publicState(page) {
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
      print_call_count: probe?.calls.length ?? -1,
      pending_print_count: probe?.pending.length ?? -1,
      source_disclosure:
        location.pathname.endsWith("/source") ||
        document.body?.innerText.includes("[[button print") === true,
    };
  }, SELECTOR);
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

  async #operation(pageUrl, mode) {
    const context = await this.#candidateContext();
    const page = await context.newPage();
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
      await page.evaluate(() => window.__open43Issue777Print.reset());
      const before = await publicState(page);
      let mutationRequestCount = 0;
      const onRequest = (request) => {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
          mutationRequestCount += 1;
        }
      };
      page.on("request", onRequest);
      try {
        if (mode === "click") await control.click();
        else if (mode === "enter") await control.press("Enter");
        else if (mode === "space") await control.press(" ");
        else {
          await page.evaluate((selector) => {
            const element = document.querySelector(selector);
            element?.click();
            element?.click();
          }, SELECTOR);
        }
        await page.waitForFunction(
          () =>
            window.__open43Issue777Print.calls.length === 1 &&
            window.__open43Issue777Print.pending.length === 1,
          null,
          { timeout: TIMEOUT_MS },
        );
        const during = await publicState(page);
        const printCalls = await page.evaluate(() =>
          structuredClone(window.__open43Issue777Print.calls),
        );
        await page.evaluate(() => window.__open43Issue777Print.release());
        await page.waitForFunction(
          (selector) =>
            document.querySelector(selector)?.hasAttribute("aria-busy") ===
            false,
          SELECTOR,
          { timeout: TIMEOUT_MS },
        );
        const after = await publicState(page);
        return {
          before,
          during,
          after,
          print_calls: printCalls,
          mutation_request_count: mutationRequestCount,
        };
      } finally {
        page.off("request", onRequest);
      }
    } finally {
      await page
        .close({ runBeforeUnload: false, timeout: 10_000 })
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
      initial = { capture, state: await publicState(page) };
    } finally {
      await page
        .close({ runBeforeUnload: false, timeout: 10_000 })
        .catch(() => undefined);
    }
    const operations = Object.fromEntries(
      await Promise.all(
        ["click", "enter", "space", "repeated"].map(async (mode) => [
          mode,
          await this.#operation(pageUrl, mode),
        ]),
      ),
    );
    return { initial, operations };
  }
}
