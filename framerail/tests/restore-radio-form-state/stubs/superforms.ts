import { writable } from "svelte/store"

type FormData = Record<string, unknown>

type SubmitOptions = {
  onSubmit?: (context: {
    jsonData: (value: FormData) => void
    cancel: () => void
  }) => void | Promise<void>
  onResult?: (context: { result: unknown; cancel: () => void }) => void | Promise<void>
}

export function superForm(initial: FormData = {}, options: SubmitOptions = {}) {
  const form = writable<FormData>({ ...initial })

  const enhance = (node: HTMLElement) => {
    const onSubmit = async (event: Event) => {
      event.preventDefault()
      let json: FormData = {}
      await options.onSubmit?.({
        jsonData: (value: FormData) => {
          json = value
        },
        cancel: () => {}
      })
      let result: unknown
      try {
        const response = await fetch("?/restore", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(json)
        })
        result = await response.json()
      } catch (error) {
        result = { type: "failure", data: { message: String(error) } }
      }
      await options.onResult?.({ result, cancel: () => {} })
    }
    node.addEventListener("submit", onSubmit)
    return {
      destroy() {
        node.removeEventListener("submit", onSubmit)
      }
    }
  }

  return { form, enhance, reset: () => {} }
}
