import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

export const OPEN43_AUTHORING_CASE_IDS = Object.freeze([
  "A1061_EXACT_PUBLIC_SLICE_CANDIDATE",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const RED_CSS = "[[module CSS]]\n.authoring-color { color: red; }\n[[/module]]";
const BLUE_CSS = "[[module CSS]]\n.authoring-color { color: blue; }\n[[/module]]";

function pageSlugs(runId) {
  const suffix = runId.slice("candidate-case-".length);
  return {
    component: `component:open43-authoring-${suffix}`,
    dependent: `open43-authoring-dependent-${suffix}`,
    unrelated: `open43-authoring-unrelated-${suffix}`,
  };
}

function styles(page, name) {
  if (!Array.isArray(page?.compiled_body_styles)) {
    throw new Error(`${name} public compiled styles are missing`);
  }
  return page.compiled_body_styles;
}

function foundArticle(value, name) {
  if (value?.page?.type !== "found" || value.page.data === null) {
    throw new Error(`${name} public article was not found`);
  }
  return value.page.data;
}

function hasStyle(stylesValue, color) {
  return stylesValue.some((style) => style.includes(`color: ${color}`));
}

class Open43AuthoringRun {
  #session;
  #resources;
  #slugs;
  #siteId = null;
  #ownedPages = [];

  constructor({ session, resources, slugs }) {
    this.#session = session;
    this.#resources = resources;
    this.#slugs = slugs;
  }

  async #rpc(method, params = {}, options = {}) {
    return await this.#session.rpc(method, params, {
      actor: options.actor ?? "editor",
      siteId: this.#siteId ?? undefined,
      page: options.page,
      cleanup: options.cleanup === true,
    });
  }

  async #page(slugOrId, { cleanup = false } = {}) {
    return await this.#rpc(
      "page_get",
      {
        site_id: this.#siteId,
        page: slugOrId,
        details: { compiled_html: true },
      },
      { cleanup, page: typeof slugOrId === "string" ? slugOrId : undefined },
    );
  }

  async #article(slug) {
    return foundArticle(
      await this.#rpc(
        "article_view",
        {
          site_id: this.#siteId,
          session_token: null,
          route: { slug, extra: "" },
          locales: ["en-US", "en"],
        },
        { actor: "anonymous", page: slug },
      ),
      `article_view ${slug}`,
    );
  }

  async #create(slug, title, wikitext) {
    const page = await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug,
      title,
      alt_title: null,
      wikitext,
      layout: "wikidot",
      revision_comments: "Open43 authoring candidate fixture",
      user_id: this.#session.editorUserId,
      ip_address: "192.0.2.61",
      tags: [],
    });
    if (
      !Number.isSafeInteger(page?.page_id) ||
      !Number.isSafeInteger(page.revision_id) ||
      page.slug !== slug
    ) {
      throw new Error(`page_create did not return the ${slug} public identity`);
    }
    const resource = this.#resources.register("page", {
      page_id: page.page_id,
      revision_id: page.revision_id,
      slug,
    });
    this.#ownedPages.push({ page, resource });
    return page;
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (
      !Number.isSafeInteger(site?.site_id) ||
      site.slug !== SITE_SLUG
    ) {
      throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    }
    this.#siteId = site.site_id;

    for (const slug of Object.values(this.#slugs)) {
      if (await this.#page(slug) !== null) {
        throw new Error(`run-owned authoring page already exists: ${slug}`);
      }
    }

    const component = await this.#create(
      this.#slugs.component,
      "Open43 authoring component",
      RED_CSS,
    );
    const dependent = await this.#create(
      this.#slugs.dependent,
      "Open43 authoring dependent",
      `[[include ${this.#slugs.component}]]\nDependent body`,
    );
    const unrelated = await this.#create(
      this.#slugs.unrelated,
      "Open43 authoring unrelated",
      "Unrelated body",
    );

    const beforeDependent = await this.#page(dependent.page_id);
    const beforeUnrelated = await this.#page(unrelated.page_id);
    const beforeArticle = await this.#article(this.#slugs.dependent);
    if (!hasStyle(styles(beforeDependent, "before dependent"), "red")) {
      throw new Error("dependent page did not publicly expose the initial red CSS");
    }

    await this.#rpc("page_edit", {
      site_id: this.#siteId,
      page: component.page_id,
      last_revision_id: component.revision_id,
      revision_comments: "Open43 authoring component blue revision",
      user_id: this.#session.editorUserId,
      wikitext: BLUE_CSS,
      ip_address: "192.0.2.61",
    });

    const firstArticle = await this.#article(this.#slugs.dependent);
    const settledArticle = await this.#waitForBlueArticle();
    const afterDependent = await this.#page(dependent.page_id);
    const afterUnrelated = await this.#page(unrelated.page_id);

    return [
      {
        case_id: "A1061_EXACT_PUBLIC_SLICE_CANDIDATE",
        observations: {
          before: {
            dependent: beforeDependent,
            unrelated: beforeUnrelated,
            article: beforeArticle,
          },
          after_component_edit: {
            first_article: firstArticle,
            settled_article: settledArticle,
            dependent: afterDependent,
            unrelated: afterUnrelated,
          },
        },
      },
    ];
  }

  async #waitForBlueArticle() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const article = await this.#article(this.#slugs.dependent);
      if (hasStyle(styles(article, "settled dependent article"), "blue")) {
        return article;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("dependent article did not expose blue CSS after the component edit");
  }

  async cleanup() {
    const failures = [];
    for (const { page } of [...this.#ownedPages].reverse()) {
      try {
        const current = await this.#page(page.slug, { cleanup: true });
        if (current === null) continue;
        if (current.page_id !== page.page_id) {
          throw new Error(`cleanup page identity drifted for ${page.slug}`);
        }
        await this.#rpc(
          "page_delete",
          {
            site_id: this.#siteId,
            page: current.page_id,
            last_revision_id: current.revision_id,
            revision_comments: "Open43 authoring candidate cleanup",
            user_id: this.#session.editorUserId,
            ip_address: "192.0.2.61",
          },
          { cleanup: true },
        );
      } catch (error) {
        failures.push(error);
      }
    }

    const absent = [];
    for (const { page, resource } of this.#ownedPages) {
      try {
        const current = await this.#page(page.slug, { cleanup: true });
        if (current !== null) throw new Error(`cleanup left ${page.slug} publicly present`);
        this.#resources.release(resource, { page_get: null });
        absent.push(page.slug);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "authoring public cleanup failed");
    return { page_get: null, absent_pages: absent };
  }
}

function verifyCase(caseId, observations) {
  if (caseId !== "A1061_EXACT_PUBLIC_SLICE_CANDIDATE") {
    throw new Error(`unsupported Open43 authoring case: ${caseId}`);
  }
  const before = observations.before;
  const after = observations.after_component_edit;
  const beforeDependentStyles = styles(before.dependent, "before dependent");
  const beforeArticleStyles = styles(before.article, "before dependent article");
  const firstStyles = styles(after.first_article, "first dependent article");
  const settledStyles = styles(after.settled_article, "settled dependent article");
  styles(after.unrelated, "after unrelated");
  if (!hasStyle(beforeDependentStyles, "red") || !hasStyle(beforeArticleStyles, "red")) {
    throw new Error("initial dependent CSS was not red at the public page and article seams");
  }
  if (!hasStyle(settledStyles, "blue") || hasStyle(settledStyles, "red")) {
    throw new Error("settled dependent article did not expose only the blue CSS");
  }
  if (
    after.dependent.revision_id !== before.dependent.revision_id ||
    after.unrelated.revision_id !== before.unrelated.revision_id ||
    sha256Value(after.unrelated.compiled_body_styles) !== sha256Value(before.unrelated.compiled_body_styles) ||
    after.unrelated.compiled_at !== before.unrelated.compiled_at
  ) {
    throw new Error("component save changed the unrelated or dependent page revision identity");
  }
  if (!Array.isArray(firstStyles)) throw new Error("first dependent article observation is invalid");
  return {
    verified: true,
    initial_red: true,
    settled_blue: true,
    first_article_styles_sha256: sha256Value(firstStyles),
    settled_article_styles_sha256: sha256Value(settledStyles),
    unrelated_styles_unchanged: true,
    unrelated_compiled_at_unchanged: true,
  };
}

function verifyCleanup(proof, resources) {
  if (
    proof?.page_get !== null ||
    !Array.isArray(proof?.absent_pages) ||
    proof.absent_pages.length !== 3 ||
    !Array.isArray(resources) ||
    resources.some((resource) => resource.released !== true)
  ) {
    throw new Error("authoring cleanup did not prove all run-owned pages absent");
  }
  return {
    public_absence_verified: true,
    page_count: proof.absent_pages.length,
  };
}

export function createOpen43AuthoringCandidateCaseSet({
  sessionFactory = (options) => new CandidateHttpSession(options),
} = {}) {
  const sourceFiles = Object.freeze([
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
    "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
    "install/local/wikidot-verification/src/open43-authoring-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]);
  return Object.freeze({
    id: "open43-authoring",
    caseIds: OPEN43_AUTHORING_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources }) {
      if (candidateIdentity.candidate.endpoint.host !== SITE_HOST) {
        throw new Error(`Open43 authoring cases require ${SITE_HOST}`);
      }
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      if (session?.editorUserId !== -1) {
        throw new Error("authoring candidate session must bind the fixed editor actor");
      }
      const execution = new Open43AuthoringRun({
        session,
        resources,
        slugs: pageSlugs(runId),
      });
      return Object.freeze({
        sourceFiles,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        plan: {
          schema: "wikijump.open43_authoring_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_slugs: pageSlugs(runId),
          editor_user_id: -1,
          public_behavior: "component CSS save updates the next public dependent article read without changing the unrelated page",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase,
        verifyCleanup,
      });
    },
  });
}
