//! Wikidot scope pairing shared by runtime-module recognition.
//!
//! These helpers once guarded the long native-list prepass. Bullet lists now
//! render through FTML (#2575); runtime modules still use the scope pairing to
//! tell whether a module head sits inside an unproven body scope.

mod source_scopes;

pub(super) use source_scopes::{
    collect_unproven_scope_ranges, matching_source_scope_close,
};

#[cfg(test)]
mod tests {
    use super::super::literal_regions::LiteralRegionIndex;
    use super::*;
    use std::time::{Duration, Instant};

    #[test]
    fn mismatched_scope_closers_stay_within_a_linear_scan_budget() {
        let mut source = String::new();
        for _ in 0..20_000 {
            source.push_str("[[span]]");
        }
        for _ in 0..20_000 {
            source.push_str("[[/bold]]");
        }
        let literals = LiteralRegionIndex::new_wikidot_module_recognition(&source);
        let started = Instant::now();
        let ranges = collect_unproven_scope_ranges(&source, &literals);
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_eq!(ranges, vec![0..source.len()]);
    }
}
