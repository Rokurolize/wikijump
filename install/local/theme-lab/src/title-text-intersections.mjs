// Supplement the container-box observation with the actual title text ranges.
// This decides intersection geometry only, never artistic source identity.
export function measureTitleTextIntersections(overlaps) {
  const title = document.querySelector('#page-title');
  if (!title) return {schema: 'theme_lab_title_text_intersections.v1', complete: false};
  const rectangles = [];
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (const box of range.getClientRects()) if (box.width > 0 && box.height > 0) {
      rectangles.push({x: box.x, y: box.y, width: box.width, height: box.height});
    }
  }
  const visibleText = rectangles.map(box => ({x: Math.max(0, box.x), y: Math.max(0, box.y),
    right: Math.min(innerWidth, box.x + box.width), bottom: Math.min(innerHeight, box.y + box.height)}))
    .filter(box => box.x < box.right && box.y < box.bottom);
  return {schema: 'theme_lab_title_text_intersections.v1', complete: rectangles.length > 0,
    title_text_rects: rectangles,
    intersections: overlaps.filter(item => item.effectively_visible && visibleText.some(box =>
      item.rect.x < box.right && item.rect.x + item.rect.width > box.x &&
      item.rect.y < box.bottom && item.rect.y + item.rect.height > box.y))};
}
