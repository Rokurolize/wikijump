import { writable } from "svelte/store"

export function superForm() {
  const form = writable<Record<string, string>>({
    name: "",
    comments: "",
    newPage: "",
    newName: "",
    destinationPage: ""
  })
  return {
    form,
    enhance: () => ({ destroy() {} }),
    reset: () => {}
  }
}

export function fileProxy() {
  return writable<FileList | null>(null)
}
