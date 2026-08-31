const SELECTOR = 'a.wiki-standalone-button[href="javascript:;"]';
const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const TIMEOUT_MS = 30_000;
const CAPTURE_CONTRACT = Object.freeze({
  slug: "issue775-edit",
  theme_family: "candidate",
  presence_probes: Object.freeze([
    { id: "standalone-edit", selector: SELECTOR },
    { id: "editor", selector: "#editor" },
  ]),
});

async function publicState(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate((selector) => {
        const active = document.activeElement;
        return {
          url: location.href,
          path: location.pathname,
          edit_route: location.pathname.endsWith("/edit"),
          standalone_edit_count: document.querySelectorAll(selector).length,
          editor_count: document.querySelectorAll("#editor").length,
          source_disclosure: location.pathname.endsWith("/source") || document.body?.innerText.includes("[[button edit") === true,
          active_element: active?.id || active?.getAttribute("class") || active?.localName || "",
        };
      }, SELECTOR);
    } catch (error) {
      if (attempt === 2 || !/Execution context was destroyed|Cannot find context with specified id/iu.test(error?.message ?? "")) throw error;
      await page.waitForLoadState("domcontentloaded", { timeout: TIMEOUT_MS });
    }
  }
  throw new Error("issue 775 browser observation did not reach a stable document");
}

export class Open43Issue775EditBrowserAdapter {
  #browserContexts;
  #pageOrigin;
  #storageState;
  #contexts = new Map();

  constructor({ browserContexts, pageOrigin, storageState }) {
    this.#browserContexts = browserContexts;
    this.#pageOrigin = pageOrigin;
    this.#storageState = storageState;
  }

  async #context(actor) {
    if (!this.#contexts.has(actor)) {
      this.#contexts.set(actor, this.#browserContexts.newCandidateContext({ storageState: this.#storageState(actor), viewport: VIEWPORT }));
    }
    return (await this.#contexts.get(actor)).context;
  }

  async #capture(page, context, url, index) {
    const capture = await this.#browserContexts.captureCandidateObservation({
      context,
      page,
      url,
      label: "A775_ACTOR_NAVIGATION_BROWSER",
      index,
      contract: CAPTURE_CONTRACT,
      viewport: VIEWPORT,
      timeoutMs: TIMEOUT_MS,
      settleMs: 0,
      onPhase: () => this.#browserContexts.setActiveFixture("A775_ACTOR_NAVIGATION_BROWSER"),
    });
    if (capture.capture_error || capture.navigation_status !== 200) throw new Error("issue 775 initial browser capture failed");
    return capture;
  }

  async #permissionResponse(page, pagePath) {
    return await page.waitForResponse((response) => response.request().method() === "POST" && response.url().includes("?/editPermission") && new URL(response.url()).pathname === pagePath, { timeout: TIMEOUT_MS });
  }

  async #activate(page, pagePath, mode, editable) {
    const control = page.locator(SELECTOR);
    if (await control.count() !== 1) throw new Error("issue 775 did not serve exactly one standalone edit control");
    await control.focus();
    const focusedControl = await page.evaluate((selector) => document.activeElement === document.querySelector(selector), SELECTOR);
    let permissionResponseCount = 0;
    const onResponse = (response) => {
      if (response.request().method() === "POST" && response.url().includes("?/editPermission")) permissionResponseCount += 1;
    };
    page.on("response", onResponse);
    try {
      const response = this.#permissionResponse(page, pagePath);
      if (mode === "click") await control.click();
      else if (mode === "keyboard") await control.press("Enter");
      else await Promise.allSettled([control.click(), control.click()]);
      await response;
      if (editable) {
        await page.waitForURL(new URL(`${pagePath}/edit`, this.#pageOrigin).href, { timeout: TIMEOUT_MS });
        await page.locator("#editor").waitFor({ state: "visible", timeout: TIMEOUT_MS });
      } else {
        await page.locator("#odialog-container").waitFor({ state: "visible", timeout: TIMEOUT_MS });
      }
      return { focused_control: focusedControl, permission_response_count: permissionResponseCount, state: await publicState(page) };
    } finally {
      page.off("response", onResponse);
    }
  }

  async #operation(actor, pageUrl, pagePath, mode, editable) {
    const context = await this.#context(actor);
    const page = await context.newPage();
    try {
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      return await this.#activate(page, pagePath, mode, editable);
    } finally {
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async #history(actor, pageUrl, pagePath, editable) {
    const context = await this.#context(actor);
    const page = await context.newPage();
    try {
      await page.goto(new URL("/", this.#pageOrigin).href, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await this.#activate(page, pagePath, "click", editable);
      await page.evaluate(() => history.back());
      await page.waitForURL(
        editable ? pageUrl : new URL("/", this.#pageOrigin).href,
        { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS },
      );
      const back = await publicState(page);
      await page.evaluate(() => history.forward());
      await page.waitForURL(
        editable ? new URL(`${pagePath}/edit`, this.#pageOrigin).href : pageUrl,
        { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS },
      );
      if (editable) await page.locator("#editor").waitFor({ state: "visible", timeout: TIMEOUT_MS });
      const forward = await publicState(page);
      return { back, forward };
    } finally {
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async run({ pageUrl, pagePath, permissions }) {
    const actors = [];
    for (const [index, [actor]] of [
      ["anonymous", false],
      ["editable_member", true],
      ["non_editable_member", false],
    ].entries()) {
      const sessionActor = actor === "editable_member" ? "administrator" : actor === "non_editable_member" ? "non_admin" : "anonymous";
      const context = await this.#context(sessionActor);
      const page = await context.newPage();
      try {
        const capture = await this.#capture(page, context, pageUrl, index);
        const initial = { capture, state: await publicState(page) };
        await page.close({ runBeforeUnload: false, timeout: 10_000 });
        const click = await this.#operation(sessionActor, pageUrl, pagePath, "click", permissions[actor]);
        const keyboard = await this.#operation(sessionActor, pageUrl, pagePath, "keyboard", permissions[actor]);
        const doubleActivation = await this.#operation(sessionActor, pageUrl, pagePath, "double", permissions[actor]);
        const backForward = await this.#history(sessionActor, pageUrl, pagePath, permissions[actor]);
        actors.push({ actor, initial, click, keyboard, double_activation: doubleActivation, back_forward: backForward });
      } finally {
        await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
      }
    }
    return actors;
  }
}
