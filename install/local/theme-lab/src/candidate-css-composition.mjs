export function composeThemeCss(mainCss, overrides, placement = 'append') {
  if (!overrides.trim()) return mainCss;
  if (placement === 'append') {
    // EOF terminates a simple import in its original stylesheet. Preserve
    // that boundary when joining a separate authority stylesheet; otherwise
    // the following rule becomes part of the import prelude and is lost.
    const source = mainCss.replace(/(@import\s+(?:url\(\s*(?:"[^"\n]+"|'[^'\n]+'|[^\s)'";]+)\s*\)|"[^"\n]+"|'[^'\n]+'))(\s*)$/iu, '$1;$2');
    return [source, overrides].filter(x => x.trim()).join('\n\n');
  }
  if (placement === 'before-wikidot-code-fence') {
    const boundary = mainCss.indexOf('\n@@');
    if (boundary < 0) throw new Error('configured Wikidot code fence boundary is missing');
    return `${mainCss.slice(0, boundary)}\n\n${overrides}\n${mainCss.slice(boundary)}`;
  }
  throw new Error(`unsupported authority override placement: ${placement}`);
}
