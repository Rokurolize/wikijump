// Project generated text with its exact computed style so Range can expose
// individual line ink boxes. Restore the owner and pseudo before returning.
export async function measureGeneratedTextLines(page, selectors) {
  return page.evaluate(selectors => {
    let serial=0;
    return selectors.flatMap(selector => {
    const match = selector.match(/^(.*?)(::before|::after)$/u);
    if (!match) throw new Error('Generated line probe requires a pseudo selector');
    return [...document.querySelectorAll(match[1])].map(owner => {
      const style = getComputedStyle(owner, match[2]);
      let text;
      try { text = JSON.parse(style.content); } catch { text = ''; }
      if (!text || style.display === 'none' || style.visibility !== 'visible') return {selector, lines: [], overlaps: []};
      const projection = document.createElement('span');
      projection.textContent = text;
      for (const property of style) projection.style.setProperty(property, style.getPropertyValue(property), 'important');
      const old = owner.getAttribute('data-theme-lab-line-probe');
      let key;
      do { key=`theme-lab-line-${serial++}`; } while(document.querySelector(`[data-theme-lab-line-probe="${key}"]`));
      const hide = document.createElement('style');
      hide.textContent = `[data-theme-lab-line-probe="${key}"]${match[2]}{content:none!important}`;
      try {
        owner.setAttribute('data-theme-lab-line-probe', key);
        document.head.append(hide);
        if (match[2] === '::before') owner.prepend(projection); else owner.append(projection);
        const range = document.createRange();
        range.selectNodeContents(projection);
        const lines = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => r.toJSON());
        const overlaps = [];
        for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
          const width = Math.min(lines[i].right, lines[j].right) - Math.max(lines[i].left, lines[j].left);
          const height = Math.min(lines[i].bottom, lines[j].bottom) - Math.max(lines[i].top, lines[j].top);
          if (width > 1 && height > 1) overlaps.push({i, j, width, height});
        }
        return {selector, text, line_height: style.lineHeight, lines, overlaps};
      } finally {
        projection.remove(); hide.remove();
        if (old === null) owner.removeAttribute('data-theme-lab-line-probe'); else owner.setAttribute('data-theme-lab-line-probe', old);
      }
    });
    });
  }, selectors);
}
