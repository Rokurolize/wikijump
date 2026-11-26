import { client } from "$lib/server/deepwell"

import type { RequestContext } from "$lib/server/request-context"

export async function siteBackupExport(
  siteId: number,
  context: RequestContext = {}
): Promise<Buffer<ArrayBuffer>> {
  const archiveHex: string = await client.request(
    "site_backup_export",
    { site: siteId },
    context
  )
  if (!/^(?:[0-9a-f]{2})*$/iu.test(archiveHex)) {
    throw new Error("Deepwell returned invalid hexadecimal site backup data")
  }
  return Buffer.from(archiveHex, "hex")
}
