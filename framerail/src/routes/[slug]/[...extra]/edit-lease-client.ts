import { deserialize } from "$app/forms"
import {
  createEditLeaseTransport,
  WikidotEditLeaseSession
} from "$lib/wikidot/wikidot-edit-lease.js"

type EditLeaseActionFailure = {
  message: string
  code?: number
  data?: Record<string, unknown>
}

export const postPageEditorAction = async (
  action: string,
  payload: Record<string, unknown>
) => {
  const text = await fetch(`?/${action}`, {
    method: "POST",
    body: JSON.stringify(payload)
  }).then((res) => res.text())
  const result = deserialize<{ res: unknown }, EditLeaseActionFailure>(text)
  if (result.type === "success" && result.data) {
    return result.data.res
  }
  if (result.type === "failure" && result.data) {
    throw Object.assign(new Error(result.data.message), {
      code: result.data.code
    })
  }
  throw new Error("The edit lock request failed.")
}

export const createPageEditLeaseSession = (): WikidotEditLeaseSession =>
  new WikidotEditLeaseSession(createEditLeaseTransport(postPageEditorAction))

export type PageDraftPayload = {
  pageId?: number
  title: string
  wikitext: string
  comments: string
}

export type PageDraftContent = {
  slug: string
  title: string
  wikitext: string
  comments: string
}

export const createPageDraftEditLeaseSession = (
  draftPayload: () => PageDraftPayload
): WikidotEditLeaseSession => {
  const transport = createEditLeaseTransport(postPageEditorAction)
  return new WikidotEditLeaseSession({
    acquire: transport.acquire,
    release: transport.release,
    renew: (credentials) =>
      postPageEditorAction("editDraftSynchronize", {
        ...draftPayload(),
        lockId: credentials.lockId,
        "lockSecret": credentials.lockSecret,
        mode: credentials.mode,
        sectionIndex: credentials.sectionIndex ?? null
      })
  })
}

export const synchronizePageDraft = (payload: PageDraftPayload) =>
  postPageEditorAction("editDraftSynchronize", {
    ...payload,
    mode: "page",
    sectionIndex: null
  })

export const getPageDraft = (pageId: number | undefined) =>
  postPageEditorAction("editDraftGet", {
    ...(pageId === undefined ? {} : { pageId })
  }) as Promise<PageDraftContent | null>

export const discardPageDraft = (pageId: number | undefined) =>
  postPageEditorAction("editDraftDiscard", {
    ...(pageId === undefined ? {} : { pageId })
  })

export const startEditLeaseTimers = (
  session: WikidotEditLeaseSession,
  sync: () => void,
  renew: () => Promise<boolean> = () => session.renew()
): (() => void) => {
  let seconds = 0
  const timer = setInterval(() => {
    seconds += 1
    if (seconds % 60 === 0 && session.status === "held") {
      void renew().then(sync)
    }
    sync()
  }, 1000)
  return () => clearInterval(timer)
}
