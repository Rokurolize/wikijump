use super::{
    LiteralRegionIndex, STATIC_ACCOUNT_MODULE_REGEX, WikidotModuleArgumentValueKind,
    wikidot_module_arguments,
};

pub(crate) fn has_theme_previewer_no_ui(wikitext: &str) -> bool {
    if !STATIC_ACCOUNT_MODULE_REGEX.is_match(wikitext) {
        return false;
    }
    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(wikitext);
    STATIC_ACCOUNT_MODULE_REGEX
        .captures_iter(wikitext)
        .any(|captures| {
            let matched = captures
                .get(0)
                .expect("a static account module capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                return false;
            }
            if !captures
                .name("name")
                .is_some_and(|name| name.as_str().eq_ignore_ascii_case("ThemePreviewer"))
            {
                return false;
            }
            let Some(head) = captures.name("head").map(|head| head.as_str()) else {
                return false;
            };
            let Some(arguments) = wikidot_module_arguments(head) else {
                return false;
            };
            arguments.len() == 1
                && arguments[0].key == "noUi"
                && arguments[0].op == "="
                && arguments[0].value_kind == WikidotModuleArgumentValueKind::DoubleQuoted
                && arguments[0].value == "true"
        })
}

/// The observable effect of an executing `[[module ThemePreviewer]]`
/// whose head carries `noUi="true"` together with a `theme_url`.
///
/// Live Wikidot renders no body output and no UI for this shape; instead
/// the module's theme_url replaces the page's theme stylesheet import
/// (verified on sigma10-jp-test: the blank form emits `@import url( );`
/// in the theme slot, and the CN theme samples emit
/// `@import url(<theme_url>)` there). A whitespace-only theme_url
/// blanks the theme import entirely.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::services::render) enum ThemePreviewerDirective {
    Blank,
    Url(String),
}

pub(in crate::services::render) fn theme_previewer_directive(
    wikitext: &str,
) -> Option<ThemePreviewerDirective> {
    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(wikitext);
    STATIC_ACCOUNT_MODULE_REGEX
        .captures_iter(wikitext)
        .filter_map(|captures| {
            let matched = captures.get(0).expect("module capture has complete match");
            if literal_regions.contains(matched.start()) {
                return None;
            }
            if !captures
                .name("name")
                .is_some_and(|name| name.as_str().eq_ignore_ascii_case("ThemePreviewer"))
            {
                return None;
            }
            captures
                .name("head")
                .and_then(|head| theme_previewer_directive_head(head.as_str()))
        })
        .next()
}

pub(in crate::services::render) fn theme_previewer_directive_head(
    head: &str,
) -> Option<ThemePreviewerDirective> {
    let arguments = wikidot_module_arguments(head)?;
    if arguments.len() != 2 {
        return None;
    }
    let no_ui = arguments.iter().any(|argument| {
        argument.key == "noUi"
            && argument.op == "="
            && argument.value_kind == WikidotModuleArgumentValueKind::DoubleQuoted
            && argument.value == "true"
    });
    let theme_url = arguments.iter().find_map(|argument| {
        (argument.key == "theme_url"
            && argument.op == "="
            && argument.value_kind == WikidotModuleArgumentValueKind::DoubleQuoted)
            .then_some(argument.value)
    });
    if !no_ui {
        return None;
    }
    let theme_url = theme_url?;
    if theme_url.trim().is_empty() {
        Some(ThemePreviewerDirective::Blank)
    } else {
        Some(ThemePreviewerDirective::Url(theme_url.to_owned()))
    }
}

pub(in crate::services::render) fn has_theme_previewer_blank(wikitext: &str) -> bool {
    matches!(
        theme_previewer_directive(wikitext),
        Some(ThemePreviewerDirective::Blank)
    )
}

pub(in crate::services::render) fn theme_previewer_url(wikitext: &str) -> Option<String> {
    match theme_previewer_directive(wikitext) {
        Some(ThemePreviewerDirective::Url(url)) => Some(url),
        _ => None,
    }
}
