/*
 * services/render/list_pages/scanner/event_merge.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#![allow(clippy::wildcard_imports)]

use super::*;

pub(super) fn collect_module_events(
    mut scanner: ModuleEventScanner<'_>,
) -> (Vec<ModuleEvent>, usize, usize, bool) {
    let mut events = Vec::new();
    while let Some(event) = scanner.next() {
        events.push(event);
    }
    let literal_advances = scanner.literal_regions.advances();
    (
        events,
        scanner
            .scanned_bytes
            .saturating_add(scanner.speculative_bytes),
        literal_advances,
        scanner.ambiguous_whole_head,
    )
}

pub(super) fn ordered_direct_event(event: ModuleEvent) -> OrderedModuleEvent {
    match event {
        ModuleEvent::Open {
            kind,
            start,
            subname_start,
            subname_end,
            opening_end,
            body_start,
            direct_candidate,
            runtime_safe,
            default_template,
            ..
        } => OrderedModuleEvent::Open {
            kind,
            start,
            end: body_start,
            direct: direct_candidate.then_some(DirectModuleOpen {
                subname_start,
                subname_end,
                opening_end,
                body_start,
                runtime_safe,
                default_template,
            }),
            projection_guard_start: None,
        },
        ModuleEvent::Close { start, end } => OrderedModuleEvent::Close { start, end },
    }
}

pub(super) fn map_projected_event(
    event: ModuleEvent,
    projection: &ListPagesSourceProjection,
    original_len: usize,
) -> OrderedModuleEvent {
    match event {
        ModuleEvent::Open {
            kind,
            start,
            body_start,
            projection_guard_start,
            ..
        } => {
            let mapped = projection.map_range(start..body_start, original_len);
            let projection_guard_start = projection_guard_start
                .map(|guard| projection.map_range(guard..body_start, original_len).start);
            OrderedModuleEvent::Open {
                kind,
                start: mapped.start,
                end: mapped.end,
                direct: None,
                projection_guard_start,
            }
        }
        ModuleEvent::Close { start, end } => {
            let mapped = projection.map_range(start..end, original_len);
            OrderedModuleEvent::Close {
                start: mapped.start,
                end: mapped.end,
            }
        }
    }
}

pub(super) fn merge_projected_and_direct_events(
    projected: Vec<OrderedModuleEvent>,
    direct: &[ModuleEvent],
    restorable: &[Range<usize>],
) -> (Vec<OrderedModuleEvent>, usize) {
    let mut merged = Vec::with_capacity(projected.len() + direct.len());
    let mut projected = projected.into_iter().peekable();
    let mut direct_cursor = 0usize;
    let mut advances = 0usize;
    while let Some(mut projected_event) = projected.next() {
        advances += 1;
        while direct.get(direct_cursor).is_some_and(|direct_event| {
            direct_event_start(*direct_event) < projected_event.start()
        }) {
            let direct_event = direct[direct_cursor];
            if range_contains_start(restorable, direct_event_start(direct_event)) {
                merged.push(ordered_direct_event(direct_event));
            }
            direct_cursor += 1;
            advances += 1;
        }
        let Some(direct_event) = direct.get(direct_cursor).copied() else {
            merged.push(projected_event);
            merged.extend(projected);
            return (merged, advances);
        };
        if direct_event_start(direct_event) == projected_event.start() {
            if direct_event_matches_ordered(direct_event, projected_event) {
                projected_event.attach_direct(direct_event);
            }
            direct_cursor += 1;
            advances += 1;
        }
        merged.push(projected_event);
    }
    while let Some(event) = direct.get(direct_cursor).copied() {
        if range_contains_start(restorable, direct_event_start(event)) {
            merged.push(ordered_direct_event(event));
        }
        direct_cursor += 1;
        advances += 1;
    }
    (merged, advances)
}

pub(super) fn merge_module_event_streams(
    primary: Vec<ModuleEvent>,
    recovery: Vec<ModuleEvent>,
) -> Vec<ModuleEvent> {
    let mut merged = Vec::with_capacity(primary.len() + recovery.len());
    let mut primary = primary.into_iter().peekable();
    let mut recovery = recovery.into_iter().peekable();
    while let (Some(left), Some(right)) = (primary.peek(), recovery.peek()) {
        match direct_event_start(*left).cmp(&direct_event_start(*right)) {
            std::cmp::Ordering::Less => merged.push(primary.next().unwrap()),
            std::cmp::Ordering::Greater => merged.push(recovery.next().unwrap()),
            std::cmp::Ordering::Equal => {
                merged.push(primary.next().unwrap());
                recovery.next();
            }
        }
    }
    merged.extend(primary);
    merged.extend(recovery);
    merged
}

pub(super) fn range_contains_start(ranges: &[Range<usize>], start: usize) -> bool {
    let insertion = ranges.partition_point(|range| range.start <= start);
    insertion > 0 && start < ranges[insertion - 1].end
}

pub(super) fn mark_projection_changed_direct_heads(
    events: &mut [OrderedModuleEvent],
    projection: &ListPagesSourceProjection,
    original: &str,
) -> usize {
    let mut guard_ranges = projection.original_range_cursor();
    let mut head_ranges = projection.original_range_cursor();

    for event in events {
        let OrderedModuleEvent::Open {
            direct,
            projection_guard_start,
            ..
        } = event
        else {
            continue;
        };
        let Some(current) = direct.as_ref() else {
            continue;
        };
        if projection_guard_start.is_some_and(|guard| {
            !guard_ranges.advance_to_range_and_check_unchanged(
                original,
                guard..current.opening_end,
            )
        }) {
            *direct = None;
            continue;
        }
        let direct = direct
            .as_mut()
            .expect("direct module remains attached after its projection guard");
        let mut head_start = direct.subname_end;
        while original
            .as_bytes()
            .get(head_start)
            .is_some_and(|byte| is_wikidot_head_spacing(*byte))
        {
            head_start += 1;
        }
        if !head_ranges.advance_to_range_and_check_unchanged(
            original,
            head_start..direct.opening_end,
        ) {
            direct.runtime_safe = false;
        }
    }

    let offset_advances = guard_ranges.advances() + head_ranges.advances();
    record_projection_offset_advances(offset_advances);
    offset_advances
}

pub(super) fn direct_event_start(event: ModuleEvent) -> usize {
    match event {
        ModuleEvent::Open { start, .. } | ModuleEvent::Close { start, .. } => start,
    }
}

fn direct_event_matches_ordered(
    direct: ModuleEvent,
    projected: OrderedModuleEvent,
) -> bool {
    match (direct, projected) {
        (
            ModuleEvent::Open {
                kind: direct_kind,
                start: direct_start,
                body_start,
                ..
            },
            OrderedModuleEvent::Open {
                kind: projected_kind,
                start: projected_start,
                end: projected_end,
                ..
            },
        ) => {
            direct_kind == projected_kind
                && direct_start == projected_start
                && body_start == projected_end
        }
        (
            ModuleEvent::Close {
                start: direct_start,
                end: direct_end,
            },
            OrderedModuleEvent::Close {
                start: projected_start,
                end: projected_end,
            },
        ) => direct_start == projected_start && direct_end == projected_end,
        _ => false,
    }
}
