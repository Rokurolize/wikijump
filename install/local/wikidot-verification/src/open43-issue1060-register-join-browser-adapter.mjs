const JOIN_SELECTOR = 'div > a[href="javascript:;"][onclick="WIKIDOT.page.listeners.join(event, \'unified\')"]';
const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const TIMEOUT_MS = 300_000;
const COOKIE_SETTLE_TIMEOUT_MS = 10_000;
const REGISTER_PATH = "/-/register";
const LOGIN_PATH = "/-/login";
const LOGOUT_PATH = "/-/logout";
const CAPTURE_CONTRACT = Object.freeze({
  slug: "issue1060-register-join-create",
  theme_family: "candidate",
  presence_probes: Object.freeze([
    Object.freeze({
      id: "system-join",
      selector: JOIN_SELECTOR,
      minimum_count: 1,
      require_rendered: true,
    }),
  ]),
});

async function publicState(page) {
  return await page.evaluate((selector) => {
    const control = document.querySelector(selector);
    return {
      url: location.href,
      path: location.pathname,
      history_length: history.length,
      join_control_count: document.querySelectorAll(selector).length,
      focused_control: control !== null && document.activeElement === control,
      aria_busy: control?.getAttribute("aria-busy") === "true",
      login_form_visible: document.querySelectorAll("#login").length > 0,
      register_form_visible: document.querySelectorAll("#register").length > 0,
      logout_button_visible: document.querySelectorAll(".button-logout").length > 0,
      editor_visible: document.querySelectorAll("#editor").length > 0,
      error_popup_visible: document.querySelectorAll("#odialog-container").length > 0,
      source_disclosure: document.body?.innerText.includes("[[module Join") === true,
    };
  }, JOIN_SELECTOR);
}

export class Open43Issue1060RegisterJoinCreateBrowserAdapter {
  #browserContexts;
  #pageOrigin;

  constructor({ browserContexts, pageOrigin }) {
    this.#browserContexts = browserContexts;
    this.#pageOrigin = pageOrigin;
  }

  async #context() {
    return (await this.#browserContexts.newCandidateContext({ viewport: VIEWPORT })).context;
  }

  #url(pathname) {
    return new URL(pathname, this.#pageOrigin).href;
  }

  async #register(context, credentials) {
    const page = await context.newPage();
    try {
      await page.goto(this.#url(REGISTER_PATH), { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await page.locator("#username").fill(credentials.username);
      await page.locator("#email").fill(credentials.email);
      await page.locator("input.auth-password").fill(credentials.password);
      await page.locator("input.confirm-password").fill(credentials.password);
      await page.locator("#locale").selectOption("en");
      await page.locator(".button-create").click();
      await page.waitForURL(this.#url(LOGIN_PATH), { timeout: TIMEOUT_MS });
      const state = await publicState(page);
      if (state.login_form_visible !== true) throw new Error("issue 1060 registration did not reach the login form");
      return state;
    } finally {
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async #login(context, credentials) {
    const page = await context.newPage();
    try {
      await page.goto(this.#url(LOGIN_PATH), { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await page.locator(".auth-name-or-email").fill(credentials.username);
      await page.locator("input.auth-password").fill(credentials.password);
      await page.locator(".button-login").click();
      await page.waitForFunction(
        () => document.querySelectorAll("#login").length === 0 && document.querySelectorAll("#login-mfa").length === 0,
        null,
        { timeout: TIMEOUT_MS },
      );
      const deadline = Date.now() + COOKIE_SETTLE_TIMEOUT_MS;
      let sessionCookies = [];
      do {
        sessionCookies = (await context.cookies(this.#pageOrigin)).filter(({ name }) => name === "wikijump_token");
        if (sessionCookies.length === 1 && sessionCookies[0].value) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      if (sessionCookies.length !== 1 || !sessionCookies[0].value) throw new Error("issue 1060 login did not settle at one candidate-origin session cookie");
      const sessionCookie = sessionCookies[0];
      return { state: await publicState(page), session_token: sessionCookie.value };
    } finally {
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async #logout(context) {
    const page = await context.newPage();
    try {
      await page.goto(this.#url(LOGOUT_PATH), { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await page.locator(".button-logout").waitFor({ state: "visible", timeout: TIMEOUT_MS });
      await page.locator(".button-logout").click();
      await page.waitForFunction(
        () => document.querySelectorAll(".button-logout").length === 0,
        null,
        { timeout: TIMEOUT_MS },
      );
      const deadline = Date.now() + COOKIE_SETTLE_TIMEOUT_MS;
      let sessionCookies = [];
      do {
        sessionCookies = (await context.cookies(this.#pageOrigin)).filter(({ name }) => name === "wikijump_token");
        if (sessionCookies.length === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      } while (Date.now() < deadline);
      return {
        state: await publicState(page),
        session_cookie_after: sessionCookies.length !== 0,
      };
    } finally {
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async #join(context) {
    const page = await context.newPage();
    let mutationRequestCount = 0;
    let navigationCount = 0;
    const onRequest = (request) => {
      if (request.method() === "POST" && request.url().includes("?/membershipJoin")) mutationRequestCount += 1;
    };
    const onNavigation = () => {
      navigationCount += 1;
    };
    page.on("request", onRequest);
    page.on("framenavigated", onNavigation);
    try {
      await page.goto(this.#url("/system:join"), { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      const control = page.locator(JOIN_SELECTOR);
      await control.waitFor({ state: "visible", timeout: TIMEOUT_MS });
      await control.focus();
      const before = await publicState(page);
      const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await control.click();
      await navigation;
      await page.waitForFunction(
        (selector) => document.querySelectorAll(selector).length === 0,
        JOIN_SELECTOR,
        { timeout: TIMEOUT_MS },
      );
      const after = await publicState(page);
      return { before, after, mutation_request_count: mutationRequestCount, navigation_count: navigationCount };
    } finally {
      page.off("request", onRequest);
      page.off("framenavigated", onNavigation);
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async #create(context, componentSlug, source) {
    const page = await context.newPage();
    try {
      await page.goto(this.#url(`/${encodeURIComponent(componentSlug)}/edit/true`), { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      await page.locator("#editor").waitFor({ state: "visible", timeout: TIMEOUT_MS });
      await page.locator('input[name="title"]').fill(`candidate-case-owner:${componentSlug}`);
      await page.locator('textarea[name="wikitext"]').fill(source);
      await page.locator('#editor input[type="submit"], #editor button[type="submit"]').click();
      await page.waitForURL(this.#url(`/${componentSlug}`), { timeout: TIMEOUT_MS });
      return await page.evaluate((expected) => ({
        path: location.pathname,
        body_contains_source: document.querySelector(".page-content")?.innerText.includes(expected) === true,
        error_popup_visible: document.querySelectorAll("#odialog-container").length > 0,
      }), source);
    } finally {
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async #readBack(context, componentSlug, source) {
    const page = await context.newPage();
    try {
      await page.goto(this.#url(`/${componentSlug}`), { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      return await page.evaluate((expected) => ({
        path: location.pathname,
        body_contains_source: document.querySelector(".page-content")?.innerText.includes(expected) === true,
        error_popup_visible: document.querySelectorAll("#odialog-container").length > 0,
      }), source);
    } finally {
      await page.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  async run({ credentials, componentSlug, source }) {
    await this.#browserContexts.setActiveFixture("A1060_BROWSER_REGISTER_JOIN_CREATE");
    const context = await this.#context();
    const capturePage = await context.newPage();
    let initial;
    try {
      const capture = await this.#browserContexts.captureCandidateObservation({
        context,
        page: capturePage,
        url: this.#url("/system:join"),
        label: "A1060_BROWSER_REGISTER_JOIN_CREATE",
        index: 0,
        contract: CAPTURE_CONTRACT,
        viewport: VIEWPORT,
        timeoutMs: TIMEOUT_MS,
        settleMs: 0,
        onPhase: () => this.#browserContexts.setActiveFixture("A1060_BROWSER_REGISTER_JOIN_CREATE"),
      });
      initial = { capture, state: await publicState(capturePage) };
    } finally {
      await capturePage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
    const register = await this.#register(context, credentials);
    const firstLogin = await this.#login(context, credentials);
    const logout = await this.#logout(context);
    const loginAgain = await this.#login(context, credentials);
    const join = await this.#join(context);
    const create = await this.#create(context, componentSlug, source);
    const readBack = await this.#readBack(context, componentSlug, source);
    return {
      username: credentials.username,
      initial,
      register,
      logout,
      login_again: { state: loginAgain.state },
      session_token: loginAgain.session_token,
      join,
      create,
      read_back: readBack,
    };
  }
}
