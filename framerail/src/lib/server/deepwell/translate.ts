import defaults from "$lib/defaults"
import { client } from "$lib/server/deepwell"
import { translateRequest } from "$lib/server/deepwell/translate-request"
import type { TranslateKeys, TranslatedKeys } from "$lib/types"

export async function translate(
  locales: string[],
  keys: TranslateKeys,
  stripKeys: string[] = defaults.translateStripKeys
): Promise<TranslatedKeys> {
  return client.request("translate", translateRequest(locales, keys, stripKeys))
}
