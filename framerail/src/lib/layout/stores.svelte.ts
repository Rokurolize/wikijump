import { Layout } from "$lib/types"

class ErrorPopupState {
  current = $state<{
    state: boolean
    title?: string | null
    leadIn?: string | null
    message: string | null
    extraMessage?: string | null
    actionLink?: { href: string; label: string } | null
    // Use original Wikidot heading + inline policy/login paragraph, not the
    // app's generic error-heading layout (source EN SCP-9506 Edit/Tags).
    wikidotSourcePolicyBody?: boolean
    closeLabel?: string
    data: unknown | null
  }>({
    state: false,
    message: null,
    data: null
  })
}

class PageLayoutState {
  current = $state<Layout>(Layout.WIKIJUMP)
}

export const errorPopupState = new ErrorPopupState()
export const pageLayoutState = new PageLayoutState()
