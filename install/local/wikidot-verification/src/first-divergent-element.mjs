const DEFAULT_ALIGNMENT_WINDOW = 64;

function elementIdentity(element) {
  const id = /^wiki-tabview-[0-9a-f]{32}$/iu.test(element?.id ?? "")
    ? "wiki-tabview-{{module-id}}"
    : (element?.id ?? null);
  return JSON.stringify([
    element?.tag ?? null,
    id,
    element?.classes ?? [],
    element?.normalized_direct_text_sha256 ??
      element?.direct_text_sha256 ??
      null,
    element?.child_element_count ?? null,
  ]);
}

function nextMatchingIndex(elements, start, identity, window) {
  const end = Math.min(elements.length, start + window + 1);
  for (let index = start + 1; index < end; index += 1) {
    if (elementIdentity(elements[index]) === identity) return index;
  }
  return null;
}

function styleDelta(local, live) {
  const delta = {};
  const properties = new Set([
    ...Object.keys(local?.style ?? {}),
    ...Object.keys(live?.style ?? {}),
  ]);
  for (const property of [...properties].sort()) {
    const localValue = local?.style?.[property] ?? null;
    const liveValue = live?.style?.[property] ?? null;
    if (localValue !== liveValue) {
      delta[property] = { local: localValue, live: liveValue };
    }
  }
  return delta;
}

function rounded(value) {
  return Math.round(Number(value) * 100) / 100;
}

function geometryDelta(local, live) {
  return Object.fromEntries(
    ["x", "y", "width", "height"].map((key) => [
      key,
      (local?.rect?.[key] ?? 0) - (live?.rect?.[key] ?? 0),
    ]),
  );
}

function roundedGeometryDelta(delta) {
  return Object.fromEntries(
    Object.entries(delta).map(([key, value]) => [key, rounded(value)]),
  );
}

function geometryDiverges(delta, thresholds) {
  return (
    Math.abs(delta.x) > thresholds.geometry_position_px ||
    Math.abs(delta.y) > thresholds.geometry_position_px ||
    Math.abs(delta.width) > thresholds.geometry_size_px ||
    Math.abs(delta.height) > thresholds.geometry_size_px
  );
}

export function compareFirstDivergenceTraces(
  local,
  live,
  {
    alignment_window = DEFAULT_ALIGNMENT_WINDOW,
    geometry_position_px = 8,
    geometry_size_px = 12,
  } = {},
) {
  if (!local || !live) {
    return {
      kind: "trace_unavailable",
      local_available: Boolean(local),
      live_available: Boolean(live),
    };
  }
  if (local.root_count !== undefined && local.root_count !== 1) {
    return {
      kind: "trace_invalid",
      side: "local",
      root_count: local.root_count,
    };
  }
  if (live.root_count !== undefined && live.root_count !== 1) {
    return { kind: "trace_invalid", side: "live", root_count: live.root_count };
  }
  const localIncomplete = local.incomplete_image_count ?? 0;
  const liveIncomplete = live.incomplete_image_count ?? 0;
  if (localIncomplete > 0 || liveIncomplete > 0) {
    return {
      kind: "resource_incomplete",
      incomplete_image_count: {
        local: localIncomplete,
        live: liveIncomplete,
      },
    };
  }

  const localElements = local.elements ?? [];
  const liveElements = live.elements ?? [];
  const limit = Math.min(localElements.length, liveElements.length);
  let previousStableAnchor = null;

  for (let index = 0; index < limit; index += 1) {
    const localElement = localElements[index];
    const liveElement = liveElements[index];
    const localIdentity = elementIdentity(localElement);
    const liveIdentity = elementIdentity(liveElement);
    if (localIdentity !== liveIdentity) {
      const localAnchorIndex = nextMatchingIndex(
        localElements,
        index,
        liveIdentity,
        alignment_window,
      );
      const liveAnchorIndex = nextMatchingIndex(
        liveElements,
        index,
        localIdentity,
        alignment_window,
      );
      if (
        localAnchorIndex !== null &&
        (liveAnchorIndex === null ||
          localAnchorIndex - index <= liveAnchorIndex - index)
      ) {
        return {
          kind: "extra_local_element",
          local_index: index,
          live_index: index,
          local: localElement,
          live: liveElement,
          previous_stable_anchor: previousStableAnchor,
          next_stable_anchor: {
            local_index: localAnchorIndex,
            live_index: index,
            element: localElements[localAnchorIndex],
          },
        };
      }
      if (liveAnchorIndex !== null) {
        return {
          kind: "missing_local_element",
          local_index: index,
          live_index: index,
          local: localElement,
          live: liveElement,
          previous_stable_anchor: previousStableAnchor,
          next_stable_anchor: {
            local_index: index,
            live_index: liveAnchorIndex,
            element: liveElements[liveAnchorIndex],
          },
        };
      }
      return {
        kind: "content_divergence",
        local_index: index,
        live_index: index,
        local: localElement,
        live: liveElement,
        previous_stable_anchor: previousStableAnchor,
      };
    }

    const styles = styleDelta(localElement, liveElement);
    if (Object.keys(styles).length > 0) {
      return {
        kind: "style_divergence",
        local_index: index,
        live_index: index,
        local: localElement,
        live: liveElement,
        style_delta: styles,
        previous_stable_anchor: previousStableAnchor,
      };
    }
    const geometry = geometryDelta(localElement, liveElement);
    if (
      geometryDiverges(geometry, { geometry_position_px, geometry_size_px })
    ) {
      return {
        kind: "geometry_divergence",
        local_index: index,
        live_index: index,
        local: localElement,
        live: liveElement,
        geometry_delta: roundedGeometryDelta(geometry),
        previous_stable_anchor: previousStableAnchor,
      };
    }
    previousStableAnchor = localElement;
  }

  if (localElements.length !== liveElements.length) {
    return {
      kind:
        localElements.length > liveElements.length
          ? "extra_local_element"
          : "missing_local_element",
      local_index: limit,
      live_index: limit,
      local: localElements[limit] ?? null,
      live: liveElements[limit] ?? null,
      previous_stable_anchor: previousStableAnchor,
      next_stable_anchor: null,
    };
  }
  if (local.truncated || live.truncated) {
    return {
      kind: "trace_truncated",
      local_index: limit,
      live_index: limit,
      previous_stable_anchor: previousStableAnchor,
      element_count: {
        local: local.element_count,
        live: live.element_count,
      },
    };
  }
  return {
    kind: "none",
    local_index: limit,
    live_index: limit,
    previous_stable_anchor: previousStableAnchor,
  };
}
