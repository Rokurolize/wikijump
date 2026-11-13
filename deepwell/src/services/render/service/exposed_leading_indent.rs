use super::{CompatTextFragments, RenderService};

impl RenderService {
    pub(super) fn protect_exposed_leading_indent_after_comment_lines(
        wikitext: &mut String,
        preserved: &mut CompatTextFragments,
    ) -> bool {
        let mut cursor = 0usize;
        let mut saw_comment = false;

        loop {
            let line_end = wikitext[cursor..]
                .find('\n')
                .map_or(wikitext.len(), |relative| cursor + relative);
            let line = &wikitext[cursor..line_end];
            if line.bytes().all(|byte| matches!(byte, b' ' | b'\t' | b'\r')) {
                if line_end >= wikitext.len() {
                    return false;
                }
                cursor = line_end + 1;
                continue;
            }
            if !line.starts_with("[!--") {
                break;
            }
            let body_start = cursor + "[!--".len();
            let Some(relative_close) = wikitext[body_start..].find("--]") else {
                return false;
            };
            let close_end = body_start + relative_close + "--]".len();
            let remainder = &wikitext[close_end..];
            let remainder_line_end = remainder.find('\n').unwrap_or(remainder.len());
            if !remainder[..remainder_line_end]
                .bytes()
                .all(|byte| byte == b'\r')
            {
                break;
            }
            saw_comment = true;
            if close_end + remainder_line_end >= wikitext.len() {
                return false;
            }
            cursor = close_end + remainder_line_end + 1;
        }

        if !saw_comment {
            return false;
        }
        let indent_len = wikitext[cursor..]
            .bytes()
            .take_while(|byte| matches!(byte, b' ' | b'\t'))
            .count();
        if indent_len == 0 {
            return false;
        }
        let marker = preserved.push("");
        wikitext.replace_range(cursor..cursor + indent_len, &marker);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn protect(source: &str) -> (String, CompatTextFragments, bool) {
        let mut wikitext = source.to_owned();
        let mut preserved = CompatTextFragments::new(source);
        let applied =
            RenderService::protect_exposed_leading_indent_after_comment_lines(
                &mut wikitext,
                &mut preserved,
            );
        (wikitext, preserved, applied)
    }

    #[test]
    fn leading_comment_only_line_protects_the_exposed_indent() {
        let (protected, fragments, applied) = protect("[!-- c --]\n * a");
        assert!(applied);
        assert_eq!(fragments.restore(&protected), "[!-- c --]\n* a");
    }

    #[test]
    fn multiline_comment_at_document_start_protects_the_exposed_indent() {
        let (protected, fragments, applied) = protect("[!--\n x\n--]\n  * a\n * b");
        assert!(applied);
        assert_eq!(fragments.restore(&protected), "[!--\n x\n--]\n* a\n * b");
    }

    #[test]
    fn comment_and_blank_lines_before_the_exposed_indent() {
        let (protected, fragments, applied) = protect("[!-- c --]\n\n * a");
        assert!(applied);
        assert_eq!(fragments.restore(&protected), "[!-- c --]\n\n* a");
    }

    #[test]
    fn non_indented_first_content_line_keeps_its_markers_depth() {
        let (protected, _, applied) = protect("[!-- c --]\n* a\n * b");
        assert!(!applied);
        assert_eq!(protected, "[!-- c --]\n* a\n * b");
    }

    #[test]
    fn remainder_after_the_closer_vetoes_the_protection() {
        let (protected, _, applied) = protect("[!-- c --] \n * a");
        assert!(!applied);
        assert_eq!(protected, "[!-- c --] \n * a");
    }

    #[test]
    fn content_before_the_comment_vetoes_the_protection() {
        let (protected, _, applied) = protect("text\n[!-- c --]\n * a");
        assert!(!applied);
        assert_eq!(protected, "text\n[!-- c --]\n * a");
    }

    #[test]
    fn document_without_comments_is_untouched() {
        let (protected, _, applied) = protect(" * a\n * b");
        assert!(!applied);
        assert_eq!(protected, " * a\n * b");
    }
}
