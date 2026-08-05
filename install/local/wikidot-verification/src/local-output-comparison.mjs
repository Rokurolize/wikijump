import {parseFragment, serialize} from "parse5";

import {canonicalDom, visibleText} from "./syntax-differential.mjs";

function rawWikidotEmailSpan(node) {
  if (node?.tagName !== "span") return false;
  const classes = node.attrs?.find((attribute) => attribute.name === "class")?.value.split(/\s+/u) ?? [];
  if (!classes.includes("wiki-email") || node.childNodes?.length !== 1) return false;
  const child = node.childNodes[0];
  if (child.nodeName !== "#text") return false;
  const separator = child.value.indexOf("#");
  return separator > 0 && child.value.slice(0, separator) === child.value.slice(separator + 1);
}

function maskRawWikidotEmails(html) {
  const fragment = parseFragment(html);
  const visit = (node) => {
    if (node?.nodeName !== "#document-fragment" && node?.tagName === "span" && rawWikidotEmailSpan(node)) {
      const classAttribute = node.attrs?.find((attribute) => attribute.name === "class");
      const classes = classAttribute?.value.split(/\s+/u).filter((value) => value && value !== "wiki-email") ?? [];
      if (classAttribute && classes.length === 0) {
        node.attrs = node.attrs.filter((attribute) => attribute !== classAttribute);
      } else if (classAttribute) {
        classAttribute.value = classes.join(" ");
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(fragment);
  return serialize(fragment);
}

export function localCanonicalDom(html) {
  return canonicalDom(maskRawWikidotEmails(html));
}

export function localVisibleText(html) {
  return visibleText(maskRawWikidotEmails(html));
}
