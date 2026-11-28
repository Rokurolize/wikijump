import { tick } from "svelte"

export const focusDialog = (dialog: HTMLElement): (() => void) => {
  const active = document.activeElement
  const previous =
    active instanceof HTMLElement && active !== document.body
      ? active
      : document.querySelector<HTMLElement>(".wikitext-editor .cm-content")
  const target = dialog.querySelector<HTMLElement>(
    "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
  )
  void tick().then(() => target?.focus())
  return () => {
    if (previous?.isConnected) previous.focus()
  }
}

export const focusAfterNavigation = async (): Promise<void> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const target = document.querySelector<HTMLElement>("#page-content, main")
    if (target) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1")
      target.focus({ preventScroll: true })
      return
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}
