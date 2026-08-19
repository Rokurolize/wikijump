const POINT_WIDGET = ".page-rate-widget-box";
const RATE_UP = `${POINT_WIDGET} > .rateup > a[href="javascript:;"]`;
const RATE_DOWN = `${POINT_WIDGET} > .ratedown > a[href="javascript:;"]`;
const RATE_CANCEL = `${POINT_WIDGET} > .cancel > a[href="javascript:;"]`;
const RATE_NUMBER = `${POINT_WIDGET} .rate-points .number`;
const STAR_WIDGET = ".page-rate-widget-start";
const STAR_IMAGE = `${STAR_WIDGET} img`;
const STAR_SCORE_INPUT = `${STAR_WIDGET} input[name="score"]`;
const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const TIMEOUT_MS = 300_000;

async function widgetState(page, { widget, point = false, star = false }) {
  return await page.evaluate(({ widget: widgetSelector, point, star }) => {
    const widgetElement = document.querySelector(widgetSelector);
    if (widgetElement === null) return { present: false };
    const busy = widgetElement.getAttribute("aria-busy") === "true";
    const errorPopup = document.querySelectorAll("#odialog-container").length > 0;
    const result = {
      present: true,
      busy,
      error_popup_visible: errorPopup,
      source_disclosure: document.body?.innerText.includes("[[module Rate") === true,
    };
    if (point) {
      const number = widgetElement.querySelector(".rate-points .number");
      result.score = number?.textContent?.trim() ?? null;
      result.rateup_count = widgetElement.querySelectorAll(".rateup > a").length;
      result.ratedown_count = widgetElement.querySelectorAll(".ratedown > a").length;
      result.cancel_count = widgetElement.querySelectorAll(".cancel > a").length;
    }
    if (star) {
      const stars = widgetElement.matches(".page-rate-widget-start")
        ? widgetElement
        : widgetElement.querySelector(".page-rate-widget-start");
      const hidden = stars?.querySelector('input[name="score"]');
      result.data_rating = stars?.getAttribute("data-rating") ?? null;
      result.star_image_count = stars?.querySelectorAll("img").length ?? 0;
      result.hidden_score = hidden?.value ?? null;
      const textRating = widgetElement
        .closest(".page-rate-widget")
        ?.querySelector(".page-rate-widget-start-text-rating");
      result.text_rating = textRating?.textContent?.trim() ?? null;
    }
    return result;
  }, { widget, point, star });
}

async function forgedRateRequest(page, body) {
  return await page.evaluate(async (requestBody) => {
    const response = await fetch("?/legacyRate", {
      method: "POST",
      credentials: "same-origin",
      body: JSON.stringify(requestBody),
    });
    let payload = null;
    try {
      payload = JSON.parse(await response.text());
    } catch {
      payload = { unparsed: true };
    }
    return {
      http_status: response.status,
      payload_type: payload?.type ?? null,
      message: payload?.data?.message ?? null,
    };
  }, body);
}

export class Open43A1030RateBrowserAdapter {
  #browserContexts;
  #pageOrigin;

  constructor({ browserContexts, pageOrigin }) {
    this.#browserContexts = browserContexts;
    this.#pageOrigin = pageOrigin;
  }

  async #context(storageState) {
    return (await this.#browserContexts.newCandidateContext({ storageState, viewport: VIEWPORT })).context;
  }

  #url(pathname) {
    return new URL(pathname, this.#pageOrigin).href;
  }

  async #captureInitial(context, page, url, label) {
    let state = null;
    const capture = await this.#browserContexts.captureCandidateObservation({
      context,
      page,
      url,
      label,
      index: 0,
      contract: {
        slug: label.toLowerCase(),
        theme_family: "candidate",
        presence_probes: [],
      },
      viewport: VIEWPORT,
      timeoutMs: TIMEOUT_MS,
      settleMs: 0,
      onPhase: async (phase) => {
        if (phase === "settled") state = await widgetState(page, label.includes("STAR") ? { widget: STAR_WIDGET, star: true } : { widget: POINT_WIDGET, point: true });
      },
    });
    if (capture?.capture_error !== undefined || capture?.navigation_status !== 200) {
      throw new Error(`A1030 browser capture failed: ${capture?.capture_error?.message ?? `status ${capture?.navigation_status}`}`);
    }
    if (state === null) throw new Error("A1030 browser settled state was not observed");
    return { capture, state };
  }

  async #pointMode({ page, pagePath, registry }) {
    const context = page.context();
    const url = this.#url(pagePath);
    await this.#browserContexts.setActiveFixture("A1030_EXACT_CANDIDATE_BROWSER_POINT");
    const initialPage = await context.newPage();
    let initial;
    try {
      initial = await this.#captureInitial(context, initialPage, url, "A1030_EXACT_CANDIDATE_BROWSER_POINT");
    } finally {
      await initialPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
    if (initial.state.present !== true || initial.state.rateup_count !== 1 || initial.state.ratedown_count !== 1 || initial.state.cancel_count !== 1) {
      throw new Error("A1030 point widget did not settle with the exact three controls");
    }
    if (initial.state.score !== "0") throw new Error("A1030 point widget did not settle at zero");

    const mutationPage = await context.newPage();
    let mutationRequestCount = 0;
    const onRequest = (request) => {
      if (request.method() === "POST" && request.url().includes("?/legacyRate")) mutationRequestCount += 1;
    };
    mutationPage.on("request", onRequest);
    let keyboard = null;
    let repeated = null;
    let changed = null;
    let canceled = null;
    let forged = null;
    try {
      await mutationPage.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await mutationPage.locator(RATE_UP).waitFor({ state: "visible", timeout: TIMEOUT_MS });

      await mutationPage.locator(RATE_UP).focus();
      await mutationPage.keyboard.press("Space");
      await mutationPage.waitForFunction((selector) => {
        const number = document.querySelector(selector);
        return number !== null && number.textContent.trim() === "+1";
      }, RATE_NUMBER, { timeout: TIMEOUT_MS });
      keyboard = await widgetState(mutationPage, { widget: POINT_WIDGET, point: true });

      await mutationPage.locator(RATE_UP).click();
      await mutationPage.waitForFunction((selector) => {
        const number = document.querySelector(selector);
        return number !== null && number.textContent.trim() === "+1";
      }, RATE_NUMBER, { timeout: TIMEOUT_MS });
      repeated = await widgetState(mutationPage, { widget: POINT_WIDGET, point: true });

      await mutationPage.locator(RATE_DOWN).click();
      await mutationPage.waitForFunction((selector) => {
        const number = document.querySelector(selector);
        return number !== null && number.textContent.trim() === "-1";
      }, RATE_NUMBER, { timeout: TIMEOUT_MS });
      changed = await widgetState(mutationPage, { widget: POINT_WIDGET, point: true });

      await mutationPage.locator(RATE_CANCEL).click();
      await mutationPage.waitForFunction((selector) => {
        const number = document.querySelector(selector);
        return number !== null && number.textContent.trim() === "0";
      }, RATE_NUMBER, { timeout: TIMEOUT_MS });
      canceled = await widgetState(mutationPage, { widget: POINT_WIDGET, point: true });

      forged = await forgedRateRequest(mutationPage, {
        pageId: registry.page_id,
        lastRevisionId: registry.revision_id,
        actionIndex: registry.actions[0].index,
        actionFingerprint: "0".repeat(32),
      });
    } finally {
      mutationPage.off("request", onRequest);
      await mutationPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }

    const reloadPage = await context.newPage();
    let reloaded;
    try {
      await reloadPage.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await reloadPage.waitForFunction((selector) => {
        const number = document.querySelector(selector);
        return number !== null && number.textContent.trim() === "0";
      }, RATE_NUMBER, { timeout: TIMEOUT_MS });
      reloaded = await widgetState(reloadPage, { widget: POINT_WIDGET, point: true });
    } finally {
      await reloadPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }

    return {
      initial: initial.state,
      keyboard,
      repeated,
      changed,
      canceled,
      reloaded,
      forged,
      mutation_request_count: mutationRequestCount,
    };
  }

  async #starMode({ page, pagePath, registry }) {
    const context = page.context();
    const url = this.#url(pagePath);
    await this.#browserContexts.setActiveFixture("A1030_EXACT_CANDIDATE_BROWSER_STAR");
    const initialPage = await context.newPage();
    let initial;
    try {
      initial = await this.#captureInitial(context, initialPage, url, "A1030_EXACT_CANDIDATE_BROWSER_STAR");
    } finally {
      await initialPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
    if (initial.state.present !== true || initial.state.star_image_count !== 5 || initial.state.hidden_score !== "0" || initial.state.data_rating !== "0") {
      throw new Error("A1030 star widget did not settle with the five raty images at zero");
    }

    const mutationPage = await context.newPage();
    let mutationRequestCount = 0;
    const onRequest = (request) => {
      if (request.method() === "POST" && request.url().includes("?/legacyRate")) mutationRequestCount += 1;
    };
    mutationPage.on("request", onRequest);
    let clicked = null;
    let repeated = null;
    let changed = null;
    let forged = null;
    try {
      await mutationPage.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await mutationPage.locator(STAR_IMAGE).first().waitFor({ state: "visible", timeout: TIMEOUT_MS });

      await mutationPage.locator(STAR_IMAGE).nth(3).click();
      await mutationPage.waitForFunction((selector) => {
        const hidden = document.querySelector(selector);
        return hidden !== null && hidden.value === "4";
      }, STAR_SCORE_INPUT, { timeout: TIMEOUT_MS });
      clicked = await widgetState(mutationPage, { widget: STAR_WIDGET, star: true });

      await mutationPage.locator(STAR_IMAGE).nth(3).click();
      await mutationPage.waitForFunction((selector) => {
        const hidden = document.querySelector(selector);
        return hidden !== null && hidden.value === "4";
      }, STAR_SCORE_INPUT, { timeout: TIMEOUT_MS });
      repeated = await widgetState(mutationPage, { widget: STAR_WIDGET, star: true });

      // The retained Wikidot star DOM exposes images without a keyboard-focus
      // affordance. Exercise a second concrete star value by click instead of
      // inventing tabindex/keyboard behavior that the oracle does not expose.
      await mutationPage.locator(STAR_IMAGE).nth(2).click();
      await mutationPage.waitForFunction((selector) => {
        const hidden = document.querySelector(selector);
        return hidden !== null && hidden.value === "3";
      }, STAR_SCORE_INPUT, { timeout: TIMEOUT_MS });
      changed = await widgetState(mutationPage, { widget: STAR_WIDGET, star: true });

      forged = await forgedRateRequest(mutationPage, {
        pageId: registry.page_id,
        lastRevisionId: registry.revision_id,
        actionIndex: registry.actions[0].index,
        actionFingerprint: "0".repeat(32),
      });
    } finally {
      mutationPage.off("request", onRequest);
      await mutationPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }

    const reloadPage = await context.newPage();
    let reloaded;
    try {
      const deadline = Date.now() + TIMEOUT_MS;
      while (Date.now() < deadline) {
        await reloadPage.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
        await reloadPage.locator(STAR_SCORE_INPUT).waitFor({ state: "attached", timeout: TIMEOUT_MS });
        reloaded = await widgetState(reloadPage, { widget: STAR_WIDGET, star: true });
        if (reloaded.hidden_score === "3") break;
        await reloadPage.waitForTimeout(1_000);
      }
      if (reloaded?.hidden_score !== "3") {
        throw new Error("A1030 star rerender did not become visible after bounded reload polling");
      }
    } finally {
      await reloadPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }

    return {
      initial: initial.state,
      clicked,
      repeated,
      changed,
      reloaded,
      forged,
      mutation_request_count: mutationRequestCount,
    };
  }

  async run({ pointPath, starPath, pointRegistry, starRegistry, session }) {
    const context = await this.#context({
      cookies: [{
        name: "wikijump_token",
        value: session.editorSessionToken,
        url: this.#pageOrigin,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      }],
      origins: [],
    });
    const capturePage = await context.newPage();
    try {
      return {
        point: await this.#pointMode({ page: capturePage, pagePath: pointPath, registry: pointRegistry, session }),
        star: await this.#starMode({ page: capturePage, pagePath: starPath, registry: starRegistry, session }),
      };
    } finally {
      await capturePage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }
}
