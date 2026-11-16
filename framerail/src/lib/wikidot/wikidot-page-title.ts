/**
 * The default title live Wikidot offers for a new page.
 *
 * Wikidot's save path stores exactly the title it is sent (an explicitly
 * emptied title stays empty, on creation and on edit alike); the default
 * exists only as a pre-fill of the new-page editor's title field. The
 * pre-filled value is derived from the page name: the category prefix is
 * dropped, the rest is split on "-", the first letter of each word is
 * capitalized, and the words are joined with spaces. Digit-leading words
 * are left untouched ("99x" stays "99x") and there is no acronym handling
 * ("scp173" becomes "Scp173"). Underscores never reach the derivation on
 * live Wikidot because fullname normalization rewrites them to "-"; they
 * are treated as separators here too so an unnormalized slug still derives
 * the same title.
 *
 * Verified against the live sandbox editor (sandbox-for-codex) on
 * 2026-11-17: "muse-probe-title-formcheck3" came pre-filled as "Muse Probe
 * Title Formcheck3", "muse-probe-title-cat2:inner-page" as "Inner Page",
 * and "muse-probe-title-mix_99x-scp173" (normalized by Wikidot to
 * "muse-probe-title-mix-99x-scp173") as "Muse Probe Title Mix 99x
 * Scp173".
 */
export const defaultPageTitleFromSlug = (slug: string): string => {
  const separator = slug.indexOf(":")
  const name = separator >= 0 ? slug.slice(separator + 1) : slug
  return name
    .replaceAll("_", "-")
    .split("-")
    .filter((word) => word.length > 0)
    .map((word) => {
      const [first, ...rest] = [...word]
      return first.toUpperCase() + rest.join("")
    })
    .join(" ")
}
