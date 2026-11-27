use super::compat::text_fragments::CompatTextFragments;
use super::include_attachment_owners::wikidot_include_directive_ranges;
use super::literal_regions::LiteralRegionIndex;
use crate::error::prelude::{Error, ErrorType, ExnError, Result};
use crate::utils::locale_is_japanese;
use ftml::data::{PageRef, canonical_include_site};
use ftml::includes::{FetchedPage, IncludeRef};
use ftml::prelude::Includer;
use regex::{Regex, RegexBuilder};
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::fmt::Write as _;
use std::sync::LazyLock;

static EMPTY_INCLUDE_TARGET_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\[\[include[ \t]+\]\]").unwrap());
static SITE_ONLY_INCLUDE_TARGET_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\[\[include[ \t]+:(?P<site>[^:\]\s]+):[ \t]*\]\]").unwrap()
});
static EMPTY_SITE_INCLUDE_TARGET_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\[\[include[ \t]+::(?P<page>[^:\]\s]+)[ \t]*\]\]").unwrap()
});
static INCLUDE_TARGET_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    RegexBuilder::new(r"^[ \t]*(?P<opening>\[\[[ \t\n]*include\s+(?P<target>[^\s|\]]+))")
        .case_insensitive(true)
        .multi_line(true)
        .build()
        .unwrap()
});

pub(super) fn missing_include_source(
    page: &str,
    site: Option<&str>,
    language: &str,
) -> String {
    let message = missing_include_message(page, site, language);
    format!("[[div class=\"error-block\"]]\n{message}\n[[/div]]")
}

fn spaced_empty_separator_missing_include_source(
    page: &str,
    site: Option<&str>,
    compat_text: &mut CompatTextFragments,
    language: &str,
) -> String {
    let opener = compat_text.push_escaped_html_text(r#"[[div class="error-block"]]"#);
    let message = missing_include_message(page, site, language);
    format!("{opener}\n{message}")
}

fn escape_missing_include_component(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '"' => escaped.push_str("&#34;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '[' => escaped.push_str("&#91;"),
            ']' => escaped.push_str("&#93;"),
            character if character.is_control() => {
                write!(escaped, "&#{};", character as u32)
                    .expect("String write cannot fail");
            }
            character => escaped.push(character),
        }
    }
    escaped
}

fn missing_include_message(page: &str, site: Option<&str>, language: &str) -> String {
    let edit_url = match site {
        Some(site) => format!("http://{site}.wikidot.com/{page}/edit/true"),
        None => format!("/{page}/edit/true"),
    };
    let page = escape_missing_include_component(page);
    let edit_url = escape_missing_include_component(&edit_url);
    if locale_is_japanese(language) {
        // Wikidot's Japanese rendering of this message, as served by
        // Japanese-language sites: the page name follows the topic
        // marker with no quotation marks, and the create-page link
        // directly abuts the closing parenthesis.
        format!(
            "インクルードを行おうとしたページ、 {page}は存在しません([[a href=\"{edit_url}\"]]ページを作成する[[/a]])"
        )
    } else {
        format!(
            "Included page \"{page}\" does not exist ([[a href=\"{edit_url}\"]]create it now[[/a]])"
        )
    }
}

pub(super) fn collect_include_display_pages(
    wikitext: &str,
) -> HashMap<PageRef, VecDeque<String>> {
    let literal_regions = LiteralRegionIndex::new_wikidot_syntax(wikitext);
    let directive_starts = wikidot_include_directive_ranges(wikitext)
        .into_iter()
        .map(|range| range.start)
        .collect::<std::collections::HashSet<_>>();
    let mut pages = HashMap::<PageRef, VecDeque<String>>::new();
    for captures in INCLUDE_TARGET_REGEX.captures_iter(wikitext) {
        let opening = captures
            .name("opening")
            .expect("include capture has an opening");
        if !directive_starts.contains(&opening.start())
            || literal_regions.contains(opening.start())
        {
            continue;
        }
        let target = &captures["target"];
        let Ok(page_ref) = PageRef::parse_include(target) else {
            continue;
        };
        let raw_page = match target
            .strip_prefix(':')
            .and_then(|value| value.split_once(':'))
        {
            Some((_site, page)) => page,
            None => target,
        };
        let raw_page = raw_page
            .find(['#', '/'])
            .map_or(raw_page, |index| &raw_page[..index]);
        pages
            .entry(page_ref)
            .or_default()
            .push_back(raw_page.to_ascii_lowercase());
    }
    pages
}

pub(super) fn align_include_directive_ranges(
    wikitext: &str,
    includes: &[IncludeRef<'_>],
) -> Option<Vec<std::ops::Range<usize>>> {
    let directive_ranges = wikidot_include_directive_ranges(wikitext);
    if directive_ranges.len() == includes.len() {
        return Some(directive_ranges);
    }
    if directive_ranges.len() < includes.len() {
        return None;
    }
    // The textual directive scan also counts include-shaped text that
    // ftml never collects (prose mentions of an include, blockquote
    // examples), so a plain count comparison cannot align the two
    // enumerations. Realign by page reference instead: keep the
    // directives whose line-start targets parse to exactly the
    // collected references, in order.
    let literal_regions = LiteralRegionIndex::new_wikidot_syntax(wikitext);
    let directive_starts = directive_ranges
        .iter()
        .map(|range| range.start)
        .collect::<std::collections::HashSet<_>>();
    let mut parsed = Vec::new();
    for captures in INCLUDE_TARGET_REGEX.captures_iter(wikitext) {
        let opening = captures
            .name("opening")
            .expect("include capture has an opening");
        if !directive_starts.contains(&opening.start())
            || literal_regions.contains(opening.start())
        {
            continue;
        }
        let Ok(page_ref) = PageRef::parse_include(&captures["target"]) else {
            continue;
        };
        parsed.push((opening.start(), page_ref));
    }
    if parsed.len() != includes.len() {
        return None;
    }
    if parsed
        .iter()
        .zip(includes.iter())
        .any(|((_, parsed_ref), include)| parsed_ref != include.page_ref())
    {
        return None;
    }
    let by_start = directive_ranges
        .iter()
        .map(|range| (range.start, range.clone()))
        .collect::<HashMap<_, _>>();
    parsed
        .iter()
        .map(|(start, _)| by_start.get(start).cloned())
        .collect()
}

pub(super) fn wikitext_has_executable_include(wikitext: &str) -> bool {
    !collect_include_display_pages(wikitext).is_empty()
}

pub(super) fn collect_missing_include_replacements(
    includes: &[IncludeRef<'_>],
    fetched_pages: &[Option<String>],
    include_display_pages: &mut HashMap<PageRef, VecDeque<String>>,
    compat_text: &mut CompatTextFragments,
    language: &str,
) -> VecDeque<String> {
    includes
        .iter()
        .zip(fetched_pages)
        .rev()
        .filter(|(_, fetched_page)| fetched_page.is_none())
        .map(|(include, _)| {
            let display_page = include_display_pages
                .get_mut(include.page_ref())
                .and_then(VecDeque::pop_back)
                .unwrap_or_else(|| include.page_ref().page().to_owned());
            if is_optional_no_visible_wikidot_include(include.page_ref()) {
                String::new()
            } else if include.has_spaced_empty_separator() {
                spaced_empty_separator_missing_include_source(
                    &display_page,
                    include.page_ref().site(),
                    compat_text,
                    language,
                )
            } else {
                missing_include_source(&display_page, include.page_ref().site(), language)
            }
        })
        .collect()
}

#[derive(Debug)]
pub(super) struct PreparedIncluder {
    pub(super) pages: Vec<Option<String>>,
    pub(super) missing_replacements: VecDeque<String>,
    pub(super) language: String,
}

impl<'t> Includer<'t> for PreparedIncluder {
    type Error = ExnError;

    fn include_pages(
        &mut self,
        includes: &[IncludeRef<'t>],
    ) -> Result<Vec<FetchedPage<'t>>> {
        if includes.len() != self.pages.len() {
            return Err(Error::new(
                "include expansion returned mismatched page references",
                ErrorType::Render,
            )
            .into());
        }

        Ok(includes
            .iter()
            .zip(std::mem::take(&mut self.pages))
            .map(|(include, content)| FetchedPage {
                page_ref: include.page_ref().clone(),
                content: content.map(Cow::Owned),
            })
            .collect())
    }

    fn no_such_include(&mut self, page_ref: &PageRef) -> Result<Cow<'t, str>> {
        let Some(replacement) = self.missing_replacements.pop_front() else {
            return Ok(wikidot_no_such_include_replacement(
                page_ref,
                &self.language,
            ));
        };
        Ok(Cow::Owned(replacement))
    }
}

pub(super) fn wikidot_no_such_include_replacement(
    page_ref: &PageRef,
    language: &str,
) -> Cow<'static, str> {
    if is_optional_no_visible_wikidot_include(page_ref) {
        Cow::Borrowed("")
    } else {
        Cow::Owned(missing_include_source(
            page_ref.page(),
            page_ref.site(),
            language,
        ))
    }
}

fn is_optional_no_visible_wikidot_include(page_ref: &PageRef) -> bool {
    let Some(site) = page_ref.site() else {
        return false;
    };
    let page = page_ref.page();
    (site.eq_ignore_ascii_case("drizzles") && page.eq_ignore_ascii_case("raven"))
        || (site.eq_ignore_ascii_case("crom") && page.eq_ignore_ascii_case("pixel"))
}

pub(super) fn normalize_trailing_colon_include_targets(wikitext: &mut String) {
    let literal_regions = LiteralRegionIndex::new_wikidot_syntax(wikitext);
    let directive_starts = wikidot_include_directive_ranges(wikitext)
        .into_iter()
        .map(|range| range.start)
        .collect::<std::collections::HashSet<_>>();
    let mut replacements = Vec::new();
    for captures in INCLUDE_TARGET_REGEX.captures_iter(wikitext) {
        let opening = captures
            .name("opening")
            .expect("include capture has an opening");
        if !directive_starts.contains(&opening.start())
            || literal_regions.contains(opening.start())
        {
            continue;
        }
        let target = captures
            .name("target")
            .expect("include capture has a target");
        if let Some(normalized) = strip_trailing_colon_include_target(target.as_str()) {
            replacements.push((target.range(), normalized));
        }
    }
    replacements.sort_by_key(|(range, _)| range.start);
    for (range, replacement) in replacements.into_iter().rev() {
        wikitext.replace_range(range, &replacement);
    }
}

fn strip_trailing_colon_include_target(target: &str) -> Option<String> {
    if !target.ends_with(':') {
        return None;
    }
    let page = match target.strip_prefix(':') {
        Some(qualified) if !qualified.starts_with(':') => {
            match qualified.split_once(':') {
                Some((_site, page)) => page,
                None => return None,
            }
        }
        Some(_) => return None,
        None => target,
    };
    let stripped = page.trim_end_matches(':');
    if stripped.is_empty() || stripped.len() == page.len() {
        return None;
    }
    let prefix_len = target.len() - page.len();
    let mut normalized = String::with_capacity(prefix_len + stripped.len());
    normalized.push_str(&target[..prefix_len]);
    normalized.push_str(stripped);
    Some(normalized)
}

pub(super) fn expand_malformed_include_targets(wikitext: &mut String, language: &str) {
    normalize_trailing_colon_include_targets(wikitext);
    if !EMPTY_INCLUDE_TARGET_REGEX.is_match(wikitext)
        && !SITE_ONLY_INCLUDE_TARGET_REGEX.is_match(wikitext)
        && !EMPTY_SITE_INCLUDE_TARGET_REGEX.is_match(wikitext)
    {
        return;
    }
    let literal_regions = LiteralRegionIndex::new_wikidot_syntax(wikitext);
    let mut replacements = EMPTY_INCLUDE_TARGET_REGEX
        .find_iter(wikitext)
        .filter(|matched| {
            !matched.as_str().eq_ignore_ascii_case("[[include ]]")
                && !literal_regions.contains(matched.start())
        })
        .map(|matched| (matched.range(), missing_include_source("", None, language)))
        .collect::<Vec<_>>();
    for captures in SITE_ONLY_INCLUDE_TARGET_REGEX.captures_iter(wikitext) {
        let matched = captures.get(0).expect("include capture has a full match");
        if !literal_regions.contains(matched.start()) {
            let site = canonical_include_site(&captures["site"]);
            replacements.push((
                matched.range(),
                missing_include_source(&site, None, language),
            ));
        }
    }
    for captures in EMPTY_SITE_INCLUDE_TARGET_REGEX.captures_iter(wikitext) {
        let matched = captures.get(0).expect("include capture has a full match");
        if !literal_regions.contains(matched.start()) {
            replacements.push((
                matched.range(),
                missing_include_source(&captures["page"], None, language),
            ));
        }
    }
    replacements.sort_by_key(|(range, _)| range.start);
    for (range, replacement) in replacements.into_iter().rev() {
        wikitext.replace_range(range, &replacement);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trailing_colon_include_targets_resolve_to_normalized_pages() {
        let mut source = concat!(
            "[[include :scp-wiki:component:license-box:]]\n",
            "[[include component:license-box-end:]]\n",
            "[[include :scp-wiki:theme:basalt: centertitle=a|acs-itemnum=a]]\n",
            "[[include :destinox:metodologia:]]\n",
        )
        .to_owned();
        expand_malformed_include_targets(&mut source, "en");
        assert!(source.contains("[[include :scp-wiki:component:license-box]]"));
        assert!(source.contains("[[include component:license-box-end]]"));
        assert!(
            source.contains(
                "[[include :scp-wiki:theme:basalt centertitle=a|acs-itemnum=a]]"
            )
        );
        assert!(source.contains("[[include :destinox:metodologia]]"));
        assert!(!source.contains(":]]"));

        let pages = collect_include_display_pages(&source);
        let license = PageRef::page_and_site("scp-wiki", "component:license-box");
        assert_eq!(
            pages
                .get(&license)
                .and_then(|values| values.front())
                .map(String::as_str),
            Some("component:license-box"),
        );
        let basalt = PageRef::page_and_site("scp-wiki", "theme:basalt");
        assert_eq!(
            pages
                .get(&basalt)
                .and_then(|values| values.front())
                .map(String::as_str),
            Some("theme:basalt"),
        );

        let mut missing_source = "[[include :destinox:metodologia:]]".to_owned();
        normalize_trailing_colon_include_targets(&mut missing_source);
        let mut display_pages = collect_include_display_pages(&missing_source);
        let includes = vec![IncludeRef::page_only(PageRef::page_and_site(
            "destinox",
            "metodologia",
        ))];
        let mut compat_text = CompatTextFragments::new(&missing_source);
        let replacements = collect_missing_include_replacements(
            &includes,
            &[None::<String>],
            &mut display_pages,
            &mut compat_text,
            "en",
        );
        let replacement = replacements.front().expect("replacement exists");
        assert!(
            replacement.contains("Included page \"metodologia\" does not exist"),
            "{replacement}",
        );
        assert!(!replacement.contains("metodologia:"), "{replacement}");
    }

    #[test]
    fn trailing_colon_normalization_leaves_other_shapes_alone() {
        for source in [
            "[[include :scp-wiki:]]",
            "[[include ::page]]",
            "[[include ::page:]]",
            "[[include :scp-wiki:component:license-box-]]",
            "[[include :scp-wiki:component:license-box]]",
            "[[code]]\n[[include component:license-box:]]\n[[/code]]",
        ] {
            let mut rewritten = source.to_owned();
            normalize_trailing_colon_include_targets(&mut rewritten);
            assert_eq!(rewritten, source, "shape must be preserved: {source}");
        }
        let mut doubled = "[[include component:license-box::]]".to_owned();
        normalize_trailing_colon_include_targets(&mut doubled);
        assert_eq!(doubled, "[[include component:license-box]]");
    }

    #[test]
    fn targetless_include_spacing_matches_each_live_shape() {
        let mut source =
            "[[include ]]\n[[include  ]]\n[[include   ]]\n[[include     ]]\n[[include\t]]"
                .to_owned();
        expand_malformed_include_targets(&mut source, "en");
        assert!(source.starts_with("[[include ]]\n"));
        assert_eq!(
            source.matches("Included page \"\" does not exist").count(),
            4
        );
        assert_eq!(source.matches("href=\"//edit/true\"").count(), 4);
    }

    #[test]
    fn argumentless_include_without_spacing_remains_literal() {
        let mut source = "[[include]] [[INCLUDE]]".to_owned();
        let original = source.clone();
        expand_malformed_include_targets(&mut source, "en");
        assert_eq!(source, original);
    }

    #[test]
    fn empty_include_targets_inside_literal_blocks_remain_literal() {
        let mut source = "[[code]]\n[[include ]]\n[[/code]]".to_owned();
        let original = source.clone();
        expand_malformed_include_targets(&mut source, "en");
        assert_eq!(source, original);
    }

    #[test]
    fn incomplete_cross_site_targets_fall_back_to_local_page_names() {
        let mut source = "[[include :scp-wiki:]]\n[[include ::page]]".to_owned();
        expand_malformed_include_targets(&mut source, "en");
        assert!(source.contains("Included page \"scp-wiki\" does not exist"));
        assert!(source.contains("href=\"/scp-wiki/edit/true\""));
        assert!(source.contains("Included page \"page\" does not exist"));
        assert!(source.contains("href=\"/page/edit/true\""));
    }

    #[test]
    fn dotted_include_site_segments_key_on_the_host_stripped_site() {
        for (target, site) in [
            (":scp-wiki.wikidot.com:component:license-box", "scp-wiki"),
            (":SCP-WIKI.WIKIDOT.COM:component:license-box", "SCP-WIKI"),
            (":scp-wiki.wikidot.com.:component:license-box", "scp-wiki"),
        ] {
            let source = format!("[[include {target}]]");
            let pages = collect_include_display_pages(&source);
            assert_eq!(pages.len(), 1, "one display page collected: {target}");
            let (key, values) = pages.iter().next().expect("display page present");
            assert_eq!(key.site(), Some(site), "dotted target site: {target}");
            assert_eq!(key.page(), "component:license-box");
            assert_eq!(
                values.front().map(String::as_str),
                Some("component:license-box"),
            );
            assert!(
                pages.contains_key(
                    &PageRef::parse_include(target)
                        .expect("dotted include target parses"),
                ),
                "display key must equal FTML's include PageRef: {target}",
            );
        }
        for target in [
            ":scp-wiki.wikidot.com:component:license-box",
            ":scp-wiki.wikidot.com.:component:license-box",
        ] {
            let source = format!("[[include {target}]]");
            let pages = collect_include_display_pages(&source);
            assert!(pages.contains_key(&PageRef::page_and_site(
                "scp-wiki",
                "component:license-box",
            )));
        }
        let uppercase = collect_include_display_pages(
            "[[include :SCP-WIKI.WIKIDOT.COM:component:license-box]]",
        );
        assert!(
            !uppercase.contains_key(&PageRef::page_and_site(
                "scp-wiki",
                "component:license-box",
            ))
        );
    }

    #[test]
    fn dashed_host_form_include_sites_stay_distinct_from_the_canonical_site() {
        let pages = collect_include_display_pages(
            "[[include :scp-jp-wikidot-com:component:jstyles]]",
        );
        assert!(pages.contains_key(&PageRef::page_and_site(
            "scp-jp-wikidot-com",
            "component:jstyles",
        )));
        assert!(
            !pages.contains_key(&PageRef::page_and_site("scp-jp", "component:jstyles",))
        );
    }

    #[test]
    fn site_only_include_targets_canonicalize_host_form_sites() {
        let mut source = "[[include :scp-jp.wikidot.com:]]".to_owned();
        expand_malformed_include_targets(&mut source, "en");
        assert!(
            source.contains("Included page \"scp-jp\" does not exist"),
            "{source}",
        );
        assert!(source.contains("href=\"/scp-jp/edit/true\""), "{source}");
        let mut dashed = "[[include :scp-jp-wikidot-com:]]".to_owned();
        expand_malformed_include_targets(&mut dashed, "en");
        assert!(
            dashed.contains("Included page \"scp-jp-wikidot-com\" does not exist"),
            "{dashed}",
        );
    }

    #[test]
    fn include_display_pages_preserve_raw_colons_separately_from_lookup_keys() {
        let pages = collect_include_display_pages(
            "[[include :scp-wiki:deleted:protected:component:magic]]",
        );
        let canonical =
            PageRef::page_and_site("scp-wiki", "deleted:protected:component:magic");
        assert_eq!(
            pages
                .get(&canonical)
                .and_then(|values| values.front())
                .map(String::as_str),
            Some("deleted:protected:component:magic"),
        );
        assert_eq!(canonical.page(), "deleted-protected-component:magic");
    }

    #[test]
    fn include_display_pages_require_an_executable_ftml_directive_boundary() {
        for source in [
            "[[include component:license",
            ">[[include component:license]]",
            "[[\rinclude component:license]]",
            "[[[!-- parser-space --]include component:license]]",
            "[[code]]\n[[include component:license]]\n[[/code]]",
        ] {
            assert!(
                collect_include_display_pages(source).is_empty(),
                "inert include source must not be collected: {source}",
            );
        }
        assert!(
            !collect_include_display_pages("[[include component:license]]").is_empty()
        );
        assert!(
            !collect_include_display_pages("[[ \t include component:license]]")
                .is_empty()
        );
    }

    #[test]
    fn include_display_pages_are_lowercase_and_follow_reverse_substitution_order() {
        let source = "A\n[[include B]]\nC\n[[include D]]\nE\n[[include F]]\nG";
        let mut display_pages = collect_include_display_pages(source);
        let includes = ["B", "D", "F"]
            .into_iter()
            .map(|page| IncludeRef::page_only(PageRef::page_only(page)))
            .collect::<Vec<_>>();
        let fetched_pages = vec![None, None, None];

        let mut compat_text = CompatTextFragments::new(source);
        let replacements = collect_missing_include_replacements(
            &includes,
            &fetched_pages,
            &mut display_pages,
            &mut compat_text,
            "en",
        );
        assert!(replacements[0].contains("Included page \"f\""));
        assert!(replacements[1].contains("Included page \"d\""));
        assert!(replacements[2].contains("Included page \"b\""));
    }

    #[test]
    fn spaced_empty_separator_uses_protected_literal_opener() {
        let source = "[[include PAGE | ]]";
        let mut display_pages = collect_include_display_pages(source);
        let includes = vec![
            IncludeRef::page_only(PageRef::page_only("PAGE"))
                .with_spaced_empty_separator(true),
        ];
        let mut compat_text = CompatTextFragments::new(source);

        let replacements = collect_missing_include_replacements(
            &includes,
            &[None],
            &mut display_pages,
            &mut compat_text,
            "en",
        );
        let replacement = replacements.front().expect("replacement exists");

        assert!(!replacement.contains("[[div class=\"error-block\"]]"));
        assert!(replacement.contains("Included page \"page\""));
        assert!(!replacement.contains("[[/div]]"));
        assert!(
            compat_text
                .restore(replacement)
                .starts_with("[[div class=&quot;error-block&quot;]]\nIncluded page")
        );
    }

    #[test]
    fn missing_include_message_uses_japanese_for_japanese_language() {
        // The exact shape served by the Japanese check wiki for a
        // missing same-site include (theme:plant).
        assert_eq!(
            missing_include_source("theme:plant", None, "ja"),
            "[[div class=\"error-block\"]]\nインクルードを行おうとしたページ、 theme:plantは存在しません([[a href=\"/theme:plant/edit/true\"]]ページを作成する[[/a]])\n[[/div]]",
        );
        // Foreign-site targets keep the absolute edit URL.
        assert_eq!(
            missing_include_message("component:sigma-plus", Some("scp-jp"), "ja"),
            "インクルードを行おうとしたページ、 component:sigma-plusは存在しません([[a href=\"http://scp-jp.wikidot.com/component:sigma-plus/edit/true\"]]ページを作成する[[/a]])",
        );
        // Wikidot's ja-corrections site language reaches this code as
        // "ja" via locale_for_ftml, but accept the raw shapes too.
        assert!(
            missing_include_message("page", None, "ja-JP")
                .starts_with("インクルードを行おうとしたページ、")
        );
        assert!(
            missing_include_message("page", None, "ja-corrections")
                .starts_with("インクルードを行おうとしたページ、")
        );
    }

    #[test]
    fn missing_include_message_stays_english_for_other_languages() {
        for language in ["en", "en-US", "default", "", "zh"] {
            assert_eq!(
                missing_include_message("theme:plant", None, language),
                "Included page \"theme:plant\" does not exist ([[a href=\"/theme:plant/edit/true\"]]create it now[[/a]])",
                "language {language} must keep the English message",
            );
        }
    }

    #[test]
    fn missing_include_message_leaves_ordinary_names_byte_for_byte() {
        assert_eq!(
            escape_missing_include_component("component:sigma-plus"),
            "component:sigma-plus",
        );
        assert_eq!(
            escape_missing_include_component("theme:plant"),
            "theme:plant",
        );
        assert_eq!(
            missing_include_message("theme:plant", None, "en"),
            "Included page \"theme:plant\" does not exist ([[a href=\"/theme:plant/edit/true\"]]create it now[[/a]])",
        );
        assert_eq!(
            missing_include_source("theme:plant", None, "ja"),
            "[[div class=\"error-block\"]]\nインクルードを行おうとしたページ、 theme:plantは存在しません([[a href=\"/theme:plant/edit/true\"]]ページを作成する[[/a]])\n[[/div]]",
        );
        assert_eq!(
            missing_include_message("component:sigma-plus", Some("scp-jp"), "en"),
            "Included page \"component:sigma-plus\" does not exist ([[a href=\"http://scp-jp.wikidot.com/component:sigma-plus/edit/true\"]]create it now[[/a]])",
        );
    }

    #[test]
    fn missing_include_message_escapes_quote_bearing_target() {
        assert_eq!(
            missing_include_message("x\"y", None, "en"),
            "Included page \"x&#34;y\" does not exist ([[a href=\"/x&#34;y/edit/true\"]]create it now[[/a]])",
        );
        assert_eq!(
            missing_include_message("x\"y", None, "ja"),
            "インクルードを行おうとしたページ、 x&#34;yは存在しません([[a href=\"/x&#34;y/edit/true\"]]ページを作成する[[/a]])",
        );
        assert_eq!(
            missing_include_message("page", Some("x\"y"), "en"),
            "Included page \"page\" does not exist ([[a href=\"http://x&#34;y.wikidot.com/page/edit/true\"]]create it now[[/a]])",
        );
    }

    #[test]
    fn missing_include_message_escapes_angle_bracket_target() {
        let message = missing_include_message("x<svg/onload=alert(1)>", None, "en");
        assert_eq!(
            message,
            "Included page \"x&lt;svg/onload=alert(1)&gt;\" does not exist ([[a href=\"/x&lt;svg/onload=alert(1)&gt;/edit/true\"]]create it now[[/a]])",
        );
        assert!(!message.contains("<svg"));
        assert!(!message.contains('>'));
    }

    #[test]
    fn missing_include_message_escapes_control_character_target() {
        let message = missing_include_message("x\u{0000}y\u{001f}z", None, "en");
        assert_eq!(
            message,
            "Included page \"x&#0;y&#31;z\" does not exist ([[a href=\"/x&#0;y&#31;z/edit/true\"]]create it now[[/a]])",
        );
        assert!(message.chars().all(|character| !character.is_control()));
    }

    #[test]
    fn missing_include_message_cannot_form_a_directive_from_target_bytes() {
        let message = missing_include_message("[[module ListPages]]", None, "en");
        assert_eq!(
            message,
            "Included page \"&#91;&#91;module ListPages&#93;&#93;\" does not exist ([[a href=\"/&#91;&#91;module ListPages&#93;&#93;/edit/true\"]]create it now[[/a]])",
        );
        assert!(!message.contains("[[module"));
        assert!(!message.contains("[[/module"));
    }

    #[test]
    fn empty_site_include_with_quote_cannot_break_the_edit_link() {
        let mut source = "[[include ::x\"y]]".to_owned();
        expand_malformed_include_targets(&mut source, "en");
        assert!(
            source.contains("Included page \"x&#34;y\" does not exist"),
            "{source}"
        );
        assert!(source.contains("href=\"/x&#34;y/edit/true\""), "{source}");
        assert!(!source.contains("/x\"y/"), "{source}");
    }

    #[test]
    fn missing_include_replacements_use_render_language() {
        let source = "[[include theme:plant]]";
        let mut display_pages = collect_include_display_pages(source);
        let includes = vec![IncludeRef::page_only(PageRef::page_only("theme:plant"))];
        let mut compat_text = CompatTextFragments::new(source);
        let replacements = collect_missing_include_replacements(
            &includes,
            &[None::<String>],
            &mut display_pages,
            &mut compat_text,
            "ja",
        );
        let replacement = replacements.front().expect("replacement exists");
        assert!(
            replacement
                .contains("インクルードを行おうとしたページ、 theme:plantは存在しません"),
            "{replacement}",
        );
    }
}
