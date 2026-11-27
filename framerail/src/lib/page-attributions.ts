import { toIntlLocales } from "$lib/wikidot/wikidot-locale"

import {
  PageAttributionKind,
  type Nullable,
  type PageAttribution,
  type TranslatedKeys,
  type UserInfo
} from "$lib/types"

export interface PageAttributionDisplay extends PageAttribution {
  user: Nullable<UserInfo>
}

const kindFallbackLabels: Record<PageAttributionKind, string> = {
  [PageAttributionKind.Author]: "Author",
  [PageAttributionKind.Rewrite]: "Rewriter",
  [PageAttributionKind.Translator]: "Translator",
  [PageAttributionKind.Maintainer]: "Maintainer"
}

export function pageAttributionKindLabel(
  kind: PageAttributionKind,
  internationalization: TranslatedKeys | undefined
): string {
  const labels: Record<PageAttributionKind, string | undefined> = {
    [PageAttributionKind.Author]:
      internationalization?.["wiki-page-attribution-kind.author"],
    [PageAttributionKind.Rewrite]:
      internationalization?.["wiki-page-attribution-kind.rewrite"],
    [PageAttributionKind.Translator]:
      internationalization?.["wiki-page-attribution-kind.translator"],
    [PageAttributionKind.Maintainer]:
      internationalization?.["wiki-page-attribution-kind.maintainer"]
  }
  return labels[kind] ?? kindFallbackLabels[kind]
}

export function formatPageAttributionDate(date: string, locales: string[]): string {
  const timestamp = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(timestamp)) return date

  return new Intl.DateTimeFormat(toIntlLocales(locales), {
    dateStyle: "medium",
    timeZone: "UTC"
  }).format(new Date(timestamp))
}
