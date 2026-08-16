import "jquery-ui/themes/base/core.css"
import "jquery-ui/themes/base/datepicker.css"
import "jquery-ui/themes/base/theme.css"

/** @type {Promise<any> | undefined} */
let datepickerRuntime

const loadDatepickerRuntime = async () => {
  if (!datepickerRuntime) {
    datepickerRuntime = (async () => {
      const { default: jquery } = await import("jquery")
      /** @type {any} */
      const browserGlobal = globalThis
      browserGlobal.jQuery = jquery
      await import("jquery-ui/ui/version")
      await import("jquery-ui/ui/keycode")
      await import("jquery-ui/ui/widgets/datepicker")
      return jquery
    })()
  }
  return await datepickerRuntime
}

/**
 * @param {HTMLInputElement} input
 * @param {Record<string, unknown>} options
 * @param {(selection: { display: string; timestamp: string }) => void} onSelect
 * @param {(display: string) => void} [onInitialDisplay]
 */
export const mountWikidotDatePicker = (input, options, onSelect, onInitialDisplay) => {
  let active = true
  let mounted = false
  /** @type {any} */
  let $ = null

  void loadDatepickerRuntime()
    .then((runtime) => {
      if (!active) return
      $ = runtime
      const datepickerOptions = {
        ...options,
        onSelect: (
          /** @type {string} */ display,
          /** @type {{ input: { 0: HTMLInputElement } }} */ instance
        ) => {
          const selected = instance.input[0]
          const date = $(selected).datepicker("getDate")
          if (date instanceof Date && Number.isFinite(date.getTime())) {
            onSelect({
              display,
              timestamp: String(Math.trunc(date.getTime() / 1000))
            })
          }
        }
      }
      $(input).datepicker(datepickerOptions)
      const storedValue = input.value.trim()
      if (/^-?\d+$/u.test(storedValue)) {
        const timestamp = Number(storedValue)
        const date = new Date(timestamp * 1000)
        if (Number.isFinite(timestamp) && Number.isFinite(date.getTime())) {
          $(input).datepicker("setDate", date)
          onInitialDisplay?.(input.value)
        }
      }
      mounted = true
    })
    .catch((error) => console.error("Wikidot datepicker initialization failed", error))

  return () => {
    active = false
    if (mounted) $(input).datepicker("destroy")
  }
}
