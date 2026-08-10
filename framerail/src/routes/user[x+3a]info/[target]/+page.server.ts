import { getFileByHash } from "$lib/server/deepwell/file"
import { userView } from "$lib/server/deepwell/user"
import { loadSiteInfo } from "$lib/server/load/site-info"
import { loadWikidotUserInfo } from "$lib/server/wikidot-user-info"

async function loadAvatar(fileHash: number[]) {
  const avatar = await getFileByHash(new Uint8Array(fileHash))
  const data = Buffer.from(await avatar.arrayBuffer()).toString("base64")
  return `data:${avatar.type};base64,${data}`
}

export async function load({ params, request, parent }) {
  const { siteId } = loadSiteInfo(request.headers)
  const { locales } = await parent()

  return loadWikidotUserInfo({
    siteId,
    locales,
    target: params.target,
    userView,
    loadAvatar
  })
}
