// Document scrollWidth cannot detect content escaping to the left.
export function viewportEscape(rect, viewportWidth, tolerance = 1) {
  const left = rect.left ?? rect.x;
  const right = rect.right ?? left + rect.width;
  return {
    left, right, viewport_width: viewportWidth,
    off_left_px: Math.max(0, -left),
    off_right_px: Math.max(0, right - viewportWidth),
    pass: Number.isFinite(left) && Number.isFinite(right) &&
      left >= -tolerance && right <= viewportWidth + tolerance,
  };
}
