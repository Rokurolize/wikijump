use super::*;

/// Regression shape from existing:theme-nebulae: four content-backed
/// ListPages modules inside one long [[iftags]] region, each body carrying
/// [[%%content{0}%%module css]] blocks and %%content{0}%%-prefixed includes.
/// A speculative-scan budget once suspected of dropping the fourth module
/// must not lose any of them.
fn nebulae_shaped_page() -> String {
    let mut source = String::from("[[iftags +テーマ]]\n");
    for i in 0..1300 {
        source.push_str(&format!(
            "filler line {i} with enough text to make the enclosing region long\n"
        ));
    }
    for n in 0..4 {
        source.push_str(&format!(
            "[[module ListPages limit=\"@URL|0\" range=\".\" urlAttrPrefix=\"ngc{n}\"]]\n\
             [[%%content{{0}}%%module css]]\n\
             :root {{ --nebula-hue: var(--cold-space); }}\n\
             [[%%content{{0}}%%/module]]\n\
             [[%%content{{0}}%%include :scp-jp:component:theme-squares -=-\n\
             | color1-name=Lagoon\n\
             | color1-variable=--nebula-hue\n\
             ]]\n\
             [[%%content{{0}}%%include :scp-jp:component:theme-squares -=-\n\
             | subcolor4-name=Cosmic Black\n\
             | subcolor4-variable=--outer-space\n\
             ]]\n\
             [[/module]]\n"
        ));
    }
    source.push_str("[[/iftags]]\n");
    source
}

#[test]
fn scanner_finds_all_nebulae_shaped_modules_after_long_iftags_body() {
    let source = nebulae_shaped_page();
    let modules = find_list_pages_module_matches(&source);
    assert_eq!(
        modules.len(),
        4,
        "all four ListPages modules must be matched: {modules:?}"
    );
    assert!(
        modules.iter().all(|module| !module.preserve_original),
        "no nebulae-shaped module may be preserved as literal source: {modules:?}"
    );
}
