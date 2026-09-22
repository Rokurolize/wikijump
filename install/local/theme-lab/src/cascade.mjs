// CSS cascade diagnosis helpers.
//
// Pure specificity math plus ranking of the declarations that actually match an
// element. The browser supplies the matching declarations; this module decides
// which one wins and why, so the agent gets "your rule lost to .scp-jp-header a"
// instead of a raw pixel delta.

export function compareSpecificity(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

const FUNCTIONAL_PSEUDO = /:(is|not|has|matches|any|where)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/giu;

export function specificity(selector) {
  let a = 0;
  let b = 0;
  let c = 0;
  const withoutFunctional = selector.replace(FUNCTIONAL_PSEUDO, (whole, name, inner) => {
    if (name.toLowerCase() === "where") return "";
    let best = [0, 0, 0];
    for (const part of inner.split(",")) {
      const candidate = specificity(part.trim());
      if (compareSpecificity(candidate, best) > 0) best = candidate;
    }
    a += best[0];
    b += best[1];
    c += best[2];
    return "";
  });

  a += (withoutFunctional.match(/#[\w-]+/gu) ?? []).length;
  b += (withoutFunctional.match(/\.[\w-]+/gu) ?? []).length;
  b += (withoutFunctional.match(/\[[^\]]*\]/gu) ?? []).length;
  b += (withoutFunctional.match(/::?[\w-]+/gu) ?? []).filter((token) => !token.startsWith("::")).length;
  c += (withoutFunctional.match(/::[\w-]+/gu) ?? []).length;

  const rest = withoutFunctional
    .replace(/#[\w-]+/gu, " ")
    .replace(/\.[\w-]+/gu, " ")
    .replace(/\[[^\]]*\]/gu, " ")
    .replace(/::?[\w-]+/gu, " ");
  c += (rest.match(/[a-zA-Z][\w-]*/gu) ?? []).length;
  return [a, b, c];
}

export function specificityString(value) {
  return `(${value.join(",")})`;
}

function declarationWins(left, right) {
  if (left.important !== right.important) return left.important;
  const bySpecificity = compareSpecificity(left.specificity, right.specificity);
  if (bySpecificity !== 0) return bySpecificity > 0;
  return left.order > right.order;
}

export function rankDeclarations(declarations) {
  const ranked = declarations
    .map((declaration) => ({...declaration, specificity: specificity(declaration.selector)}))
    .sort((left, right) => (declarationWins(left, right) ? -1 : 1));
  return ranked;
}

export function cascadeDiagnosis({selector, property, referenceValue, candidateValue, declarations, mediaInactive = [], inline = null, variables = null}) {
  const ranked = rankDeclarations(declarations ?? []);
  const winner = ranked[0] ?? null;
  const status = winner ? "overridden" : "no_declaration";
  return {
    selector,
    property,
    reference_value: referenceValue ?? null,
    candidate_value: candidateValue ?? null,
    status,
    winner: winner
      ? {
          selector: winner.selector,
          value: winner.value,
          important: winner.important,
          specificity: winner.specificity,
          media: winner.media ?? null,
        }
      : null,
    inline,
    overridden: ranked.slice(1, 4).map((declaration) => ({
      selector: declaration.selector,
      value: declaration.value,
      important: declaration.important,
      specificity: declaration.specificity,
      media: declaration.media ?? null,
    })),
    media_inactive: mediaInactive.slice(0, 4),
    variables,
  };
}
