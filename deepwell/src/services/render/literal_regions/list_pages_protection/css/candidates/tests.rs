/*
 * services/render/literal_regions/list_pages_protection/css/candidates/tests.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use super::{
    collect_all_pinned_css_module_openers_with_work, collect_pinned_css_module_candidates,
};

#[test]
fn pinned_candidate_stream_keeps_inner_css_after_an_earlier_owner_ends() {
    let source = concat!(
        "[!-- ",
        "[[ module CSS]]outer ",
        "--]",
        "[[ module CSS]]inner",
        "[[/module]]",
    );
    let outer_start = source.find("[[ module CSS]]").unwrap();
    let earlier_owner_end = source.find("--]").unwrap() + "--]".len();
    let inner_start = source.rfind("[[ module CSS]]").unwrap();
    let candidates = collect_pinned_css_module_candidates(source);

    assert!(outer_start < earlier_owner_end);
    assert!(earlier_owner_end <= inner_start);
    assert_eq!(
        candidates,
        vec![outer_start..source.len(), inner_start..source.len()],
    );

    let quoted = "> [[ module CSS]]quoted[[/module]]";
    let quoted_start = quoted.find("[[ module CSS]]").unwrap();
    assert_eq!(
        collect_pinned_css_module_candidates(quoted),
        vec![quoted_start..quoted.len()],
    );
}

#[test]
fn malformed_quoted_css_head_does_not_hide_a_resurrected_inner_css_candidate() {
    for suffix in ["", "\n"] {
        let source = format!(
            "[[module CSS note=\"unterminated [[module CSS]][[module CountPages]][[/module]]{suffix}",
        );
        let inner_start = source.rfind("[[module CSS]]").unwrap();
        let close_end = source.find("[[/module]]").unwrap() + "[[/module]]".len();

        assert_eq!(
            collect_pinned_css_module_candidates(&source),
            vec![inner_start..close_end],
            "{suffix:?}",
        );
    }
}

#[test]
fn a_complete_outer_head_without_a_body_close_does_not_hide_inner_css() {
    let source = "[[module CSS note=\"[[module CSS]]x[[/module]]\"]]";
    let inner_start = source.rfind("[[module CSS]]").unwrap();
    let inner_close_end = source.find("[[/module]]").unwrap() + "[[/module]]".len();

    assert_eq!(
        collect_pinned_css_module_candidates(source),
        vec![inner_start..inner_close_end],
    );
}

#[test]
fn dense_malformed_outer_heads_keep_nested_openers_with_linear_work() {
    const PAIRS: usize = 4_096;
    const PREFIX: &str = "[[module CSS note=\"unterminated ";
    const INNER: &str = "[[module CSS]]";
    let mut source = String::with_capacity((PREFIX.len() + INNER.len()) * PAIRS + 16);
    for _ in 0..PAIRS {
        source.push_str(PREFIX);
        source.push_str(INNER);
        source.push('\n');
    }

    let (openers, work) = collect_all_pinned_css_module_openers_with_work(&source);
    assert_eq!(openers.len(), PAIRS);
    assert!(
        work <= source.len() * 96,
        "candidate scan used {work} work units for {} bytes",
        source.len(),
    );
}

#[test]
fn dense_pinned_candidate_stream_reuses_one_next_close_index() {
    const OPENERS: usize = 4_096;
    const OPENER: &str = "[[ module CSS]]";
    let mut source = OPENER.repeat(OPENERS);
    source.push_str("[[/module]]");
    let candidates = collect_pinned_css_module_candidates(&source);

    assert_eq!(candidates.len(), OPENERS);
    for (index, candidate) in candidates.iter().enumerate() {
        assert_eq!(candidate.start, index * OPENER.len());
        assert_eq!(candidate.end, source.len());
    }
}

#[test]
fn non_counting_css_openers_in_list_pages_bodies_are_not_candidates() {
    // LP-RESIDUALS-CSS: the candidate graph feeds the ListPages
    // scanner's literal regions, so an indented (muse-probe-lp-unc-e9)
    // or tailed (muse-probe-lp-unc-e16) CSS opener inside a ListPages
    // body must not become a candidate range either; pairing it with
    // the outer module's close would consume the body before the
    // pairing layer runs.
    let outer = "[[module ListPages category=\"probe-lp-target-y\" order=\"title\"]]";
    let e9 = format!(
        "{outer}\nBEFORE %%fullname%%\n  [[module CSS]]\n.seg-i {{ color: rgb(8, 8, 8); }}\nAFTER %%fullname%%\n[[/module]]"
    );
    assert!(collect_pinned_css_module_candidates(&e9).is_empty());
    let e16 = format!(
        "{outer}\nBEFORE %%fullname%%\n[[module CSS]].seg-u {{ color: rgb(5, 5, 5); }}\nAFTER %%fullname%%\n[[/module]]"
    );
    assert!(collect_pinned_css_module_candidates(&e16).is_empty());

    // An own-line CSS opener inside the body still becomes a
    // candidate consuming the outer close.
    let unclosed = format!(
        "{outer}\nBEFORE %%fullname%%\n[[module CSS]]\n.lp-probe-x {{ color: rgb(1, 2, 3); }}\nAFTER %%fullname%%\n[[/module]]"
    );
    let candidates = collect_pinned_css_module_candidates(&unclosed);
    assert_eq!(candidates.len(), 1);
    assert!(unclosed[candidates[0].clone()].ends_with("[[/module]]"));
}
