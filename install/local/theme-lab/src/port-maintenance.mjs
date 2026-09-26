import crypto from "node:crypto";

import {parseStyleSheet} from "./css-probe.mjs";
import {extractUnconditionalCssModules} from "../ports/scripts/extract-css-modules.mjs";

export function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function unique(values) {
  return [...new Set(values)];
}

function cssFromSource(source, activeTags = []) {
  try {
    return extractUnconditionalCssModules(source, {activeTags});
  } catch (error) {
    if (/No unconditional CSS modules found/u.test(String(error?.message))) return "";
    throw error;
  }
}

function ruleFingerprintMap(css) {
  const map = new Map();
  for (const rule of parseStyleSheet(css)) {
    const key = JSON.stringify([rule.atContext ?? [], rule.selector]);
    const values = map.get(key) ?? [];
    values.push(sha256Text((rule.body ?? "").trim()));
    map.set(key, values);
  }
  return map;
}

function parseRuleKey(key) {
  const [atContext, selector] = JSON.parse(key);
  return {selector, at_context: atContext};
}

export function diffCssRules(beforeCss, afterCss) {
  const before = ruleFingerprintMap(beforeCss);
  const after = ruleFingerprintMap(afterCss);
  const keys = new Set([...before.keys(), ...after.keys()]);
  const rows = [];
  for (const key of keys) {
    const left = before.get(key);
    const right = after.get(key);
    if (left && right && JSON.stringify(left) === JSON.stringify(right)) continue;
    let status = "changed";
    if (!left) status = "added";
    else if (!right) status = "removed";
    rows.push({...parseRuleKey(key), status, before_rule_count: left?.length ?? 0, after_rule_count: right?.length ?? 0});
  }
  rows.sort((a, b) => `${a.selector}\0${a.at_context.join("\0")}`.localeCompare(`${b.selector}\0${b.at_context.join("\0")}`));
  return rows;
}

export function extractSCPJPAdaptationBlocks(source) {
  const blocks = [];
  const modulePattern = /\[\[module\s+CSS\]\]([\s\S]*?)\[\[\/module\]\]/giu;
  for (const match of source.matchAll(modulePattern)) {
    const css = match[1].trim();
    const comments = [...css.matchAll(/\/\*([\s\S]*?)\*\//gu)].map((item) => item[1].replace(/\s+/gu, " ").trim());
    const markerIndex = comments.findIndex((comment) => /^SCP-JP\b/iu.test(comment));
    if (markerIndex < 0) continue;
    const marker = comments[markerIndex];
    const rationale = comments.slice(markerIndex + 1).find((comment) => comment && comment !== marker) ?? marker;
    const rules = parseStyleSheet(css);
    blocks.push({
      marker,
      rationale,
      sha256: sha256Text(css),
      selectors: unique(rules.map((rule) => rule.selector)).sort(),
      at_contexts: unique(rules.flatMap((rule) => rule.atContext ?? [])).sort(),
    });
  }
  return blocks;
}

function importUrls(assetsReceipt) {
  return unique((assetsReceipt?.imports ?? []).map((item) => typeof item === "string" ? item : item?.source_url).filter(Boolean)).sort();
}

function importProvenance(assetsReceipt) {
  return (assetsReceipt?.import_provenance ?? []).map((row) => ({
    source_url: row.source_url,
    final_url: row.final_url ?? row.source_url,
    sha256: row.sha256,
    bytes: row.bytes,
    content_type: row.content_type,
    asset_file: row.asset_file ?? null,
    normalized_text_sha256: row.normalized_text_sha256 ?? null,
    provenance_basis: row.provenance_basis ?? null,
  }));
}

function sourceTags(manifest) {
  return manifest?.interactive_acceptance?.theme_source?.active_tags ?? manifest?.source_identity?.en?.tags ?? [];
}

function candidateTags(manifest, source = "") {
  const explicit = manifest?.interactive_acceptance?.theme_source?.candidate_tags;
  if (Array.isArray(explicit) && explicit.length) return explicit;
  if (/\[\[iftags\s+[^\]]*\+テーマ(?:\s|\]\])/iu.test(source)) return ["テーマ"];
  return [];
}

function absoluteMetadataPaths(manifest) {
  const rows = [];
  const sourcePath = manifest?.source_identity?.en?.source_path;
  const humanPath = manifest?.human_port_candidate_path;
  if (typeof sourcePath === "string" && sourcePath.startsWith("/")) rows.push("source_identity.en.source_path");
  if (typeof humanPath === "string" && humanPath.startsWith("/")) rows.push("human_port_candidate_path");
  return rows;
}

export function buildPortMaintenanceAudit({manifest, upstreamSource, humanPortSource, candidateSource, assetsReceipt = {}, maintenanceException = null, maintenanceManifest = null}) {
  const upstreamCss = cssFromSource(upstreamSource, sourceTags(manifest));
  const inferredCandidateTags = candidateTags(manifest, humanPortSource);
  const localizedCss = cssFromSource(humanPortSource, inferredCandidateTags);
  const baselineRuleChanges = diffCssRules(upstreamCss, localizedCss);
  const adaptations = extractSCPJPAdaptationBlocks(candidateSource);
  const imports = importUrls(assetsReceipt);
  const provenance = importProvenance(assetsReceipt);
  const provenanceUrls = new Set(provenance.map((row) => row.source_url));
  const upstreamSha = sha256Text(upstreamSource);
  return {
    theme: manifest.slug,
    reference_url: manifest.reference_url,
    upstream: {
      file: manifest.source_file ?? "upstream-en.wikidot.txt",
      sha256: upstreamSha,
      expected_sha256: manifest.en_source_sha256 ?? manifest?.source_identity?.en?.sha256 ?? null,
      matches_manifest: upstreamSha === (manifest.en_source_sha256 ?? manifest?.source_identity?.en?.sha256),
      updated_at: manifest.en_updated_at ?? manifest?.source_identity?.en?.updated_at ?? null,
      active_tags: sourceTags(manifest),
    },
    localization_baseline: {
      file: manifest.human_port_candidate ?? "human-port-candidate.wikidot.txt",
      sha256: sha256Text(humanPortSource),
      active_tags: inferredCandidateTags,
      inline_css_changed_rule_count: baselineRuleChanges.length,
      inline_css_changed_selectors: unique(baselineRuleChanges.map((row) => row.selector)).sort(),
      inline_css_rule_changes: baselineRuleChanges,
    },
    final_candidate: {
      sha256: sha256Text(candidateSource),
      adaptation_block_count: adaptations.length,
      adaptations,
    },
    upstream_dependencies: {
      css_import_count: imports.length,
      css_import_urls: imports,
      import_provenance_status: assetsReceipt?.import_provenance_status ?? "legacy-untracked",
      import_provenance_count: provenance.length,
      import_provenance: provenance,
      missing_import_provenance: imports.filter((url) => !provenanceUrls.has(url)),
      maintenance_exception: maintenanceException,
    },
    flattened_css_transforms: {
      manifest: manifest.flattened_css_transforms ?? null,
      applied_count: assetsReceipt?.localization_transforms?.length ?? 0,
      applied: assetsReceipt?.localization_transforms ?? [],
      manifest_provenance: assetsReceipt?.localization_transform_manifest ?? null,
    },
    maintenance_source: {
      bound: Boolean(manifest.maintenance_source),
      files: manifest.maintenance_source ?? null,
      adaptation_block_count: maintenanceManifest?.adaptation_block_count ?? null,
      raw_override_rule_count: maintenanceManifest?.raw_override_rule_count ?? null,
      canonical_override_rule_count: maintenanceManifest?.canonical_override_rule_count ?? null,
      exact_duplicate_rules_removed: maintenanceManifest?.exact_duplicate_rules_removed ?? null,
      semantic_css_sha256: maintenanceManifest?.semantic_css_sha256 ?? null,
      canonical_override_sha256: maintenanceManifest?.canonical_override_sha256 ?? null,
    },
    metadata: {
      nonportable_absolute_path_fields: absoluteMetadataPaths(manifest),
    },
  };
}

export function buildUpstreamUpdatePlan({audit, manifest, oldUpstreamSource, newUpstreamSource}) {
  const tags = sourceTags(manifest);
  const oldCss = cssFromSource(oldUpstreamSource, tags);
  const newCss = cssFromSource(newUpstreamSource, tags);
  const upstreamRuleChanges = diffCssRules(oldCss, newCss);
  const changedSelectors = new Set(upstreamRuleChanges.map((row) => row.selector));
  const baselineSelectors = new Set(audit.localization_baseline.inline_css_changed_selectors);
  const adaptationSelectors = new Set(audit.final_candidate.adaptations.flatMap((block) => block.selectors));
  const collisions = [...changedSelectors].filter((selector) => baselineSelectors.has(selector) || adaptationSelectors.has(selector)).sort();
  return {
    theme: audit.theme,
    old_upstream_sha256: sha256Text(oldUpstreamSource),
    new_upstream_sha256: sha256Text(newUpstreamSource),
    page_source_changed: oldUpstreamSource !== newUpstreamSource,
    upstream_inline_css_rule_change_count: upstreamRuleChanges.length,
    upstream_inline_css_rule_changes: upstreamRuleChanges,
    localization_overlap_selectors: collisions,
    localization_overlap_count: collisions.length,
    transitive_css_dependency_refresh_required: audit.upstream_dependencies.css_import_count > 0,
    transitive_css_dependency_count: audit.upstream_dependencies.css_import_count,
    missing_current_import_provenance: audit.upstream_dependencies.missing_import_provenance,
    review_scope: {
      rebase_localized_inline_css: upstreamRuleChanges.length > 0,
      recheck_jp_overrides: collisions.length > 0,
      refresh_imported_css_even_if_urls_are_unchanged: audit.upstream_dependencies.css_import_count > 0,
    },
  };
}
