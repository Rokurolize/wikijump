export function composeThemeCss(mainCss, overrides, placement = 'append') {
  if (!overrides.trim()) return mainCss;
  if (placement === 'append') return [mainCss, overrides].filter(x => x.trim()).join('\n\n');
  if (placement === 'before-wikidot-code-fence') {
    const boundary = mainCss.indexOf('\n@@');
    if (boundary < 0) throw new Error('configured Wikidot code fence boundary is missing');
    return `${mainCss.slice(0, boundary)}\n\n${overrides}\n${mainCss.slice(boundary)}`;
  }
  throw new Error(`unsupported authority override placement: ${placement}`);
}
