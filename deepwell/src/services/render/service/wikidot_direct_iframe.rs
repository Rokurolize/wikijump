//! Wikidot's direct emission of a saved `[[html]]` block that holds one iframe.

use super::{LazyLock, Regex, RenderService};

static WIKIDOT_DIRECT_HTML_IFRAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)^\s*(?P<iframe><iframe\b(?P<attrs>[^<>]*)>\s*</iframe\s*>)\s*$"#)
        .expect("direct Wikidot HTML iframe expression is valid")
});
static WIKIDOT_DIRECT_HTML_IFRAME_ATTRIBUTE_REGEX: LazyLock<Regex> = LazyLock::new(
    || {
        Regex::new(
            r#"(?is)\s+(?P<name>[a-z][a-z0-9:-]*)(?:\s*=\s*(?P<value>"[^"<>]*"|'[^'<>]*'|[^\s"'=<>`]+))?"#,
        )
        .expect("direct Wikidot HTML iframe attribute expression is valid")
    },
);

impl RenderService {
    /// The iframe a saved `[[html]]` block holds when Wikidot emits it
    /// directly instead of behind the hosted `html-block-iframe` wrapper.
    ///
    /// The block must hold one empty iframe with at least one recognized
    /// attribute and no unknown one. A `src` that is present must be a single
    /// absolute http(s) URL, the same gate as the legacy `[[iframe]]`
    /// directive: a repeated, bare, `javascript:`, `data:`, or relative `src`
    /// keeps the hosted wrapper. An iframe without `src` loads nothing, and
    /// live Wikidot emits it directly (for example a title-only iframe).
    pub(super) fn wikidot_direct_html_iframe(html_block: &str) -> Option<&str> {
        const ALLOWED_ATTRIBUTES: &[&str] = &[
            "align",
            "allow",
            "allowfullscreen",
            "class",
            "frameborder",
            "height",
            "loading",
            "referrerpolicy",
            "sandbox",
            "scrolling",
            "src",
            "style",
            "title",
            "width",
        ];

        let captures = WIKIDOT_DIRECT_HTML_IFRAME_REGEX.captures(html_block)?;
        let attributes = captures
            .name("attrs")
            .expect("direct iframe capture has attributes")
            .as_str();
        let mut cursor = 0;
        let mut has_attribute = false;
        let mut src_seen = false;
        for attribute in
            WIKIDOT_DIRECT_HTML_IFRAME_ATTRIBUTE_REGEX.captures_iter(attributes)
        {
            let whole = attribute
                .get(0)
                .expect("direct iframe attribute capture has whole match");
            if !attributes[cursor..whole.start()].trim().is_empty() {
                return None;
            }
            let name = attribute
                .name("name")
                .expect("direct iframe attribute capture has name")
                .as_str()
                .to_ascii_lowercase();
            if !ALLOWED_ATTRIBUTES.contains(&name.as_str()) {
                return None;
            }
            if name == "src" {
                // Browsers resolve the first src and compare its scheme
                // case-insensitively, so a repeated src cannot be vetted.
                if std::mem::replace(&mut src_seen, true) {
                    return None;
                }
                let raw = attribute.name("value")?.as_str();
                let unquoted = raw
                    .strip_prefix('"')
                    .and_then(|rest| rest.strip_suffix('"'))
                    .or_else(|| {
                        raw.strip_prefix('\'')
                            .and_then(|rest| rest.strip_suffix('\''))
                    })
                    .unwrap_or(raw);
                // Live probes cover HTTP and HTTPS src values for direct
                // emission, and list sandbox among the pass-through
                // attributes, so sandbox stays allowlisted.
                if !(unquoted.starts_with("https://") || unquoted.starts_with("http://"))
                {
                    return None;
                }
            }
            has_attribute = true;
            cursor = whole.end();
        }
        if !attributes[cursor..].trim().is_empty() || !has_attribute {
            return None;
        }
        captures.name("iframe").map(|iframe| iframe.as_str())
    }
}
