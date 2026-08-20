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
    const busy = widgetElement.getAttribute("aria-busy") === "true" || widgetElement.querySelector('[aria-busy="true"]') !== null;
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
      const images = [...(stars?.querySelectorAll("img") ?? [])];
      result.focusable_image_count = images.filter((image) => image.tabIndex >= 0).length;
      result.tabindex_attribute_count = images.filter((image) => image.hasAttribute("tabindex")).length;
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
    const rawBody = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = { unparsed: true };
    }
    return {
      http_status: response.status,
      payload_type: payload?.type ?? null,
      message: payload?.data?.message ?? null,
      raw_body: rawBody,
    };
  }, body);
}

function captureProof(capture) {
  return {
    navigation_status: capture.navigation_status,
    first_paint: capture.first_paint?.screenshot != null,
    settled: capture.screenshot != null,
    failure_count: Array.isArray(capture.failures) ? capture.failures.length : -1,
  };
}

function publicFailure(value) {
  return {
    http_status: value.http_status,
    payload_type: value.payload_type,
    message: value.message,
  };
}

function requestBody(registry, actionIndex = 0, actionFingerprint = registry.actions[actionIndex].fingerprint) {
  return {
    pageId: registry.page_id,
    lastRevisionId: registry.revision_id,
    actionIndex: registry.actions[actionIndex].index,
    actionFingerprint,
  };
}

async function withTimeout(promise, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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

  async #heldActivation(page, control, activate, stateOptions) {
    const matcher = (candidateUrl) => candidateUrl.href.includes("?/legacyRate");
    let release;
    let observed;
    let handlerStarted = false;
    let handlerError = null;
    let finishHandler;
    const hold = new Promise((resolve) => { release = resolve; });
    const intercepted = new Promise((resolve) => { observed = resolve; });
    const handlerFinished = new Promise((resolve) => { finishHandler = resolve; });
    const handler = async (route) => {
      handlerStarted = true;
      try {
        observed();
        await hold;
        await route.continue();
      } catch (error) {
        handlerError = error;
      } finally {
        finishHandler();
      }
    };
    let localRequestCount = 0;
    const onRequest = (request) => {
      if (request.method() === "POST" && request.url().includes("?/legacyRate")) localRequestCount += 1;
    };
    page.on("request", onRequest);
    await page.route(matcher, handler, { times: 1 });
    try {
      const activation = activate();
      await withTimeout(intercepted, "A1030 held Rate request was not observed");
      const busy = await widgetState(page, stateOptions);
      const beforeRepeatedActivation = localRequestCount;
      await control.click();
      await page.waitForTimeout(100);
      const doubleSuppressed = localRequestCount === beforeRepeatedActivation;
      release();
      await activation;
      return { busy, double_suppressed: doubleSuppressed };
    } finally {
      release?.();
      if (handlerStarted) await handlerFinished;
      page.off("request", onRequest);
      await page.unroute(matcher, handler).catch(() => undefined);
      if (handlerError !== null) throw handlerError;
    }
  }

  async #errorSurface(page, control, forged, stateOptions) {
    const matcher = (candidateUrl) => candidateUrl.href.includes("?/legacyRate");
    const handler = async (route) => {
      await route.fulfill({
        status: forged.http_status,
        contentType: "application/json",
        body: forged.raw_body,
      });
    };
    await page.route(matcher, handler, { times: 1 });
    try {
      await control.click();
      await page.locator("#odialog-container").waitFor({ state: "visible", timeout: TIMEOUT_MS });
      return await widgetState(page, stateOptions);
    } finally {
      await page.unroute(matcher, handler).catch(() => undefined);
    }
  }

  async #reloadUntil(page, url, stateOptions, field, expected) {
    const started = Date.now();
    const deadline = started + TIMEOUT_MS;
    let attempts = 0;
    let state = null;
    while (Date.now() < deadline) {
      attempts += 1;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      state = await widgetState(page, stateOptions);
      if (state?.[field] === expected) {
        return {
          state,
          cache: { reload_attempts: attempts, elapsed_ms: Date.now() - started, score: expected },
        };
      }
      await page.waitForTimeout(1_000);
    }
    throw new Error(`A1030 ${field} did not become ${expected} after bounded reload polling`);
  }

  async #navigation(context, url, stateOptions, field) {
    const page = await context.newPage();
    let replayRequestCount = 0;
    const onRequest = (request) => {
      if (request.method() === "POST" && request.url().includes("?/legacyRate")) replayRequestCount += 1;
    };
    page.on("request", onRequest);
    try {
      await page.goto(new URL("/", this.#pageOrigin).href, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await page.goBack({ waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      const backPath = new URL(page.url()).pathname;
      await page.goForward({ waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      const forward = await widgetState(page, stateOptions);
      return { back_path: backPath, forward_score: forward?.[field] ?? null, replay_request_count: replayRequestCount };
    } finally {
      page.off("request", onRequest);
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async #csrf(context, url, body, stateOptions, field) {
    const response = await context.request.post(new URL("?/legacyRate", url).href, {
      headers: {
        origin: "https://csrf.invalid",
        "content-type": "text/plain;charset=UTF-8",
      },
      data: JSON.stringify(body),
      timeout: TIMEOUT_MS,
    });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      const state = await widgetState(page, stateOptions);
      return { http_status: response.status(), score_after: state?.[field] ?? null };
    } finally {
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
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
    let error = null;
    let keyboardFocus = false;
    let busy = null;
    let doubleSuppressed = false;
    try {
      await mutationPage.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      const rateUp = mutationPage.locator(RATE_UP);
      await rateUp.waitFor({ state: "visible", timeout: TIMEOUT_MS });

      await rateUp.focus();
      keyboardFocus = await mutationPage.evaluate((selector) => document.activeElement === document.querySelector(selector), RATE_UP);
      const held = await this.#heldActivation(
        mutationPage,
        rateUp,
        () => mutationPage.keyboard.press("Space"),
        { widget: POINT_WIDGET, point: true },
      );
      busy = held.busy;
      doubleSuppressed = held.double_suppressed;
      await mutationPage.waitForFunction((selector) => {
        const number = document.querySelector(selector);
        return number !== null && number.textContent.trim() === "+1";
      }, RATE_NUMBER, { timeout: TIMEOUT_MS });
      keyboard = await widgetState(mutationPage, { widget: POINT_WIDGET, point: true });

      await rateUp.click();
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

      forged = await forgedRateRequest(mutationPage, requestBody(registry, 0, "0".repeat(32)));
      error = await this.#errorSurface(mutationPage, rateUp, forged, { widget: POINT_WIDGET, point: true });
    } finally {
      mutationPage.off("request", onRequest);
      await mutationPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }

    const reloadPage = await context.newPage();
    let reload;
    try {
      reload = await this.#reloadUntil(reloadPage, url, { widget: POINT_WIDGET, point: true }, "score", "0");
    } finally {
      await reloadPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
    const navigation = await this.#navigation(context, url, { widget: POINT_WIDGET, point: true }, "score", "0");
    const csrf = await this.#csrf(context, url, requestBody(registry), { widget: POINT_WIDGET, point: true }, "score");

    return {
      initial_capture: captureProof(initial.capture),
      initial: initial.state,
      keyboard_focus: keyboardFocus,
      busy,
      double_suppressed: doubleSuppressed,
      keyboard,
      repeated,
      changed,
      canceled,
      reloaded: reload.state,
      navigation,
      csrf,
      error,
      cache: reload.cache,
      forged: publicFailure(forged),
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
    let error = null;
    let busy = null;
    let doubleSuppressed = false;
    try {
      await mutationPage.goto(url, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      const fourthStar = mutationPage.locator(STAR_IMAGE).nth(3);
      await fourthStar.waitFor({ state: "visible", timeout: TIMEOUT_MS });

      const held = await this.#heldActivation(
        mutationPage,
        fourthStar,
        () => fourthStar.click(),
        { widget: STAR_WIDGET, star: true },
      );
      busy = held.busy;
      doubleSuppressed = held.double_suppressed;
      await mutationPage.waitForFunction((selector) => {
        const hidden = document.querySelector(selector);
        return hidden !== null && hidden.value === "4";
      }, STAR_SCORE_INPUT, { timeout: TIMEOUT_MS });
      clicked = await widgetState(mutationPage, { widget: STAR_WIDGET, star: true });

      await fourthStar.click();
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

      forged = await forgedRateRequest(mutationPage, requestBody(registry, 0, "0".repeat(32)));
      error = await this.#errorSurface(mutationPage, mutationPage.locator(STAR_IMAGE).nth(2), forged, { widget: STAR_WIDGET, star: true });
    } finally {
      mutationPage.off("request", onRequest);
      await mutationPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }

    const reloadPage = await context.newPage();
    let reload;
    try {
      reload = await this.#reloadUntil(reloadPage, url, { widget: STAR_WIDGET, star: true }, "hidden_score", "3");
    } finally {
      await reloadPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
    const navigation = await this.#navigation(context, url, { widget: STAR_WIDGET, star: true }, "hidden_score", "3");
    const csrf = await this.#csrf(context, url, requestBody(registry, 2), { widget: STAR_WIDGET, star: true }, "hidden_score");

    return {
      initial_capture: captureProof(initial.capture),
      initial: initial.state,
      focusable_image_count: initial.state.focusable_image_count,
      tabindex_attribute_count: initial.state.tabindex_attribute_count,
      busy,
      double_suppressed: doubleSuppressed,
      clicked,
      repeated,
      changed,
      reloaded: reload.state,
      navigation,
      csrf,
      error,
      cache: reload.cache,
      forged: publicFailure(forged),
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
