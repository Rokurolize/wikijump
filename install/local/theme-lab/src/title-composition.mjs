// Runs in the browser. This observes local rendering, never source intent.
export function measureTitleComposition() {
  const title = document.querySelector('#page-title');
  if (!title) return {schema: 'theme_lab_title_composition.v1', complete: false, overlaps: []};
  const titleBox = title.getBoundingClientRect();
  const rect = box => ({x: box.x, y: box.y, width: box.width, height: box.height});
  const visibleIntersection = (element, box) => {
    let left = Math.max(box.left, titleBox.left), right = Math.min(box.right, titleBox.right);
    let top = Math.max(box.top, titleBox.top), bottom = Math.min(box.bottom, titleBox.bottom);
    for (let current = element; current; current = current.parentElement) {
      const style = getComputedStyle(current), bounds = current.getBoundingClientRect();
      if (style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || Number(style.opacity) === 0) return false;
      if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)) {left = Math.max(left, bounds.left); right = Math.min(right, bounds.right);}
      if (['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)) {top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom);}
    }
    return left < right && top < bottom;
  };
  const overlaps = [];
  for (const element of document.querySelectorAll('body *')) {
    if (title.contains(element) || element.children.length || !(element.innerText ?? element.textContent ?? '').trim()) continue;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || box.left >= titleBox.right || box.right <= titleBox.left || box.top >= titleBox.bottom || box.bottom <= titleBox.top) continue;
    const style = getComputedStyle(element);
    overlaps.push({tag: element.tagName, id: element.id, class: String(element.className),
      text: (element.innerText ?? element.textContent ?? '').trim(), rect: rect(box),
      color: style.color, background: style.backgroundColor, position: style.position, z: style.zIndex,
      effectively_visible: visibleIntersection(element, box)});
  }
  return {schema: 'theme_lab_title_composition.v1', complete: true, title_rect: rect(titleBox), overlaps};
}
