/**
 * User-interface locales supported by this Framerail deployment.
 *
 * Keep this capability list authoritative for registration and display
 * preferences. Deepwell may accept additional BCP-47 identifiers for
 * imported or future data, but those are not advertised to users until UI
 * support is added here.
 */
export const USER_INTERFACE_LOCALES = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "pl", label: "Polski" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "zh-Hans", label: "简体中文" }
] as const

const supportedLocaleValues: ReadonlySet<string> = new Set(
  USER_INTERFACE_LOCALES.map(({ value }) => value)
)

export function isSupportedUserInterfaceLocale(locale: string): boolean {
  return supportedLocaleValues.has(locale)
}

export function areSupportedUserInterfaceLocales(locales: string[]): boolean {
  return locales.length > 0 && locales.every(isSupportedUserInterfaceLocale)
}
