import type { TranslateKeys } from "$lib/types"

export interface TranslateRequest {
  locales: string[]
  messages: TranslateKeys
  strip_message_keys: string[]
  allow_missing: boolean
}

// Deepwell rejects a strip key whose message is not requested, so a batch
// that asks for only some keys (the MFA label, the logout error) must not
// carry the page defaults' strip keys along.
export function translateRequest(
  locales: string[],
  keys: TranslateKeys,
  stripKeys: string[]
): TranslateRequest {
  return {
    locales,
    messages: keys,
    strip_message_keys: stripKeys.filter((key) => Object.hasOwn(keys, key)),
    // Presentation batches resolve missing keys to null instead of failing
    // the whole request, so one missing key (for example from a stale locale
    // catalog during rollout) cannot turn a page into HTTP 500. Deepwell
    // still logs the missing key server-side for diagnosis.
    allow_missing: true
  }
}
