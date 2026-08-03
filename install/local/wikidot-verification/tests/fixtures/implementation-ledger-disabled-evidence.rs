#[test]
#[ignore]
fn ignored_rust_seam() {}

#[ignore = "disabled evidence"]
#[test]
fn ignored_before_test_rust_seam() {}

#[cfg(any())]
#[test]
fn cfg_before_test_rust_seam() {}

#[test]
#[cfg(any())]
fn cfg_after_test_rust_seam() {}

// #[test]
// fn comment_only_rust_seam() {}
const STRING_ONLY_DECLARATION: &str = "#[test] fn string_only_rust_seam() {}";

#[test]
fn runnable_rust_seam() {
    let _ = STRING_ONLY_DECLARATION;
}
