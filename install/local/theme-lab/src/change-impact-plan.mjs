import fs from "node:fs";
import path from "node:path";

// Advisory PR work planner. The output MUST NOT be used to mint, transfer or
// skip a current-acceptance receipt. The existing final gate independently
// verifies every required row on the current target runtime.
const THEME_ROOT = "install/local/theme-lab/ports/";
const TEST_ROOTS = [
  "install/local/theme-lab/tests/",
  "framerail/tests/",
  "deepwell/tests/",
];
const DOC = /\.(?:md|mdx|rst)$/iu;

function safePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !path.posix.isAbsolute(value) &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value.split("/").every((part) => part && part !== "." && part !== "..") &&
    !/^[a-z]:/iu.test(value)
  );
}

function themeOf(file, themes) {
  if (!file.startsWith(THEME_ROOT)) return null;
  const remainder = file.slice(THEME_ROOT.length);
  const [name, ...rest] = remainder.split("/");
  if (!themes.has(name) || rest.length === 0) return null;
  return { name, remainder: rest.join("/") };
}

function themeName(slug) {
  if (typeof slug !== "string" || !slug.startsWith("theme:")) return null;
  return slug.slice(6);
}

function dependencyHints(changedThemes, graph, maintained) {
  const edges = new Map([...maintained].map((t) => [t, new Set()]));
  for (const row of graph) {
    const dependent = themeName(row.slug);
    if (!dependent || !maintained.has(dependent)) continue;
    for (const input of [
      ...(row.en_includes ?? []),
      ...(row.jp_includes ?? []),
    ]) {
      if (typeof input !== "string") continue;
      // Enumerate canonical page references only. This graph is historical
      // discovery evidence, not an exhaustive transitive CSS dependency proof.
      for (const match of input.matchAll(
        /(?:^|:)theme:([a-z][a-z0-9-]*)\b/giu,
      )) {
        if (maintained.has(match[1]) && match[1] !== dependent)
          edges.get(match[1]).add(dependent);
      }
    }
  }
  const affected = new Set(changedThemes),
    work = [...changedThemes];
  while (work.length) {
    const current = work.pop();
    for (const dependent of edges.get(current) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        work.push(dependent);
      }
    }
  }
  return [...affected].sort();
}

export function planThemeLabChanges(
  changedPaths,
  { packages, upstreamGraph, visualPolicy },
) {
  if (
    !Array.isArray(changedPaths) ||
    !Array.isArray(upstreamGraph) ||
    !packages ||
    typeof packages !== "object" ||
    !Array.isArray(visualPolicy?.rows) ||
    visualPolicy?.counts?.V +
      visualPolicy?.counts?.C +
      visualPolicy?.counts?.M !==
      145
  ) {
    throw new Error(
      "maintained packages, dependency inventory and canonical 145-row policy are required",
    );
  }
  const themes = new Set(Object.keys(packages));
  const counts = { V: 0, C: 0, M: 0 },
    keys = new Set();
  for (const row of visualPolicy.rows) {
    if (
      !Object.hasOwn(counts, row.class) ||
      !["chromium", "firefox", "webkit"].includes(row.browser_engine) ||
      !["desktop", "laptop", "tablet", "mobile", "narrow-mobile"].includes(
        row.viewport,
      ) ||
      typeof row.surface !== "string" ||
      typeof row.state !== "string"
    ) {
      throw new Error("canonical state policy has an unrecognized row");
    }
    counts[row.class]++;
    const key = `${row.browser_engine}/${row.viewport}/${row.surface}/${row.state}`;
    if (keys.has(key))
      throw new Error("canonical state policy contains duplicate rows");
    keys.add(key);
  }
  if (
    themes.size !== 36 ||
    visualPolicy.rows.length !== 145 ||
    Object.keys(counts).some((key) => counts[key] !== visualPolicy.counts[key])
  ) {
    throw new Error("maintained campaign identity is incomplete");
  }
  const paths = [...new Set(changedPaths)];
  if (paths.some((file) => !safePath(file)))
    return {
      schema: "theme_lab_pr_change_impact_plan.v1",
      scope: "full",
      reason: "unsafe or unknown changed path",
      changed_paths: paths,
      mandatory_themes: [...themes].sort(),
      advisory_priority_themes: [],
      estimated_canonical_rows: 36 * 145,
      authority: "planning_only_not_current_acceptance",
    };
  const priority = new Set();
  const fullReasons = [];
  const lowImpact = [];
  for (const file of paths) {
    if (
      DOC.test(file) &&
      (file.startsWith("docs/") ||
        file.endsWith("/README.md") ||
        file.endsWith("/PORT.md") ||
        file === "README.md" ||
        file.startsWith("install/local/theme-lab/ports/") ||
        file === "install/local/theme-lab/README.md")
    ) {
      lowImpact.push({ file, classification: "documentation" });
      continue;
    }
    // Changed tests do not modify the candidate runtime, but their own suites
    // must run. Fixtures and snapshots do not qualify as test-only.
    if (
      TEST_ROOTS.some((prefix) => file.startsWith(prefix)) &&
      /\.(?:test\.[cm]?js|spec\.ts|rs|py)$/iu.test(file)
    ) {
      lowImpact.push({ file, classification: "test-code" });
      continue;
    }
    const theme = themeOf(file, themes);
    if (theme) {
      priority.add(theme.name);
      fullReasons.push({
        file,
        reason:
          "theme candidate/dependency graph not independently proven complete",
      });
      continue;
    }
    fullReasons.push({
      file,
      reason: "runtime/global/authority or unclassified change",
    });
  }
  const graphThemes = new Set(
    upstreamGraph.map((row) => themeName(row.slug)).filter(Boolean),
  );
  const missingGraph = [...themes]
    .filter((theme) => !graphThemes.has(theme))
    .sort();
  const priorityWithDependents = dependencyHints(
    priority,
    upstreamGraph,
    themes,
  );
  if (paths.length === 0)
    return {
      schema: "theme_lab_pr_change_impact_plan.v1",
      scope: "no-changes",
      reason: "no changed paths",
      changed_paths: [],
      mandatory_themes: [],
      advisory_priority_themes: [],
      estimated_canonical_rows: 0,
      authority: "planning_only_not_current_acceptance",
    };
  // Only code-free changes avoid planned browser capture. Runtime/source/asset
  // and unknown impact all require full campaign until the graph proves both
  // negative and positive dependencies against a current, reviewed authority.
  const codeFree = fullReasons.length === 0;
  const required = codeFree ? [] : [...themes].sort();
  return {
    schema: "theme_lab_pr_change_impact_plan.v1",
    scope: codeFree ? "code-free" : "full",
    reason: codeFree
      ? "documentation/test sources only"
      : "dependency graph does not certify safe narrow reruns",
    changed_paths: paths,
    mandatory_themes: required,
    advisory_priority_themes: priorityWithDependents,
    estimated_canonical_rows: required.length * 145,
    graph_coverage: {
      maintained: themes.size,
      discovered: graphThemes.size,
      missing: missingGraph,
    },
    detailed_reasons: fullReasons,
    nonruntime_files: lowImpact,
    authority: "planning_only_not_current_acceptance",
  };
}

export function planChangeImpactFromRepository(repoRoot, changedPaths) {
  const read = (rel) =>
    JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
  const ports = "install/local/theme-lab/ports/";
  return planThemeLabChanges(changedPaths, {
    packages: read(`${ports}adaptation-authority.json`).packages,
    upstreamGraph: read(`${ports}en-theme-dependency-graph.json`).themes,
    visualPolicy: read(`${ports}current-acceptance/visual-gate-policy.json`),
  });
}
