/**
 * @typedef {{
 *   value: string
 *   label: string
 * }} WikidotDataFormValue
 */

/**
 * @typedef {{
 *   name: string
 *   label: string
 *   hint: string
 *   field_type: string | null
 *   values: WikidotDataFormValue[]
 *   default_value: string | null
 *   configured_value?: string | null
 * }} WikidotDataFormField
 */

/**
 * @typedef {{
 *   fields: WikidotDataFormField[]
 * }} WikidotDataFormDefinition
 */

/**
 * @typedef {{
 *   control: "none" | "input" | "existing"
 *   inputType: "password" | "text" | null
 *   className: string | null
 *   includeInFormFields: boolean
 *   display: "text" | "masked" | "wiki" | "url"
 * }} WikidotDataFormFieldPresentation
 */

/**
 * Builds the editable values for a Wikidot data form.
 *
 * @param {WikidotDataFormDefinition} definition
 * @param {Record<string, string>} savedValues
 * @returns {Record<string, string>}
 */
export const buildWikidotDataFormState = (definition, savedValues) => {
  return Object.fromEntries(
    definition.fields
      .filter((field) => !["hidden", "static"].includes(field.field_type ?? ""))
      .map((field) => [
        field.name,
        Object.hasOwn(savedValues, field.name)
          ? savedValues[field.name]
          : field.field_type === "checkbox"
            ? field.default_value === "1"
              ? "1"
              : "0"
            : (field.default_value ??
              (field.field_type === "select" && field.values.length >= 5
                ? (field.values[0]?.value ?? "")
                : ""))
      ])
  )
}

/**
 * Returns the observed editor and display contract for a field.
 *
 * @param {WikidotDataFormField} field
 * @returns {WikidotDataFormFieldPresentation}
 */
export const getWikidotDataFormFieldPresentation = (field) => {
  switch (field.field_type) {
    case "hidden":
      return {
        control: "none",
        inputType: null,
        className: null,
        includeInFormFields: false,
        display: "text"
      }
    case "password":
      return {
        control: "input",
        inputType: "password",
        className: "form-control form-password",
        includeInFormFields: true,
        display: "masked"
      }
    case "static":
      return {
        control: "none",
        inputType: null,
        className: null,
        includeInFormFields: true,
        display: "wiki"
      }
    case "url":
      return {
        control: "input",
        inputType: "text",
        className: "form-control form-url",
        includeInFormFields: true,
        display: "url"
      }
    default:
      return {
        control: "existing",
        inputType: null,
        className: null,
        includeInFormFields: true,
        display: "text"
      }
  }
}

/** @param {WikidotDataFormDefinition} definition */
export const wikidotDataFormFieldNames = (definition) =>
  definition.fields
    .filter((field) => getWikidotDataFormFieldPresentation(field).includeInFormFields)
    .map((field) => field.name)

const WIKIDOT_BARE_URL = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/[A-Za-z0-9._/-]*)?$/u
const WIKIDOT_FTP_URL =
  /^ftp:\/\/[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/[A-Za-z0-9._/-]*)?$/u

/** @param {string} value */
export const wikidotDataFormUrlDisplay = (value) => {
  if (WIKIDOT_FTP_URL.test(value)) return { text: value, href: value }
  if (WIKIDOT_BARE_URL.test(value)) {
    const normalized = `http://${value}`
    return { text: normalized, href: normalized }
  }
  return { text: value, href: null }
}

const WIKIDOT_PLAIN_SCALAR = /^[A-Za-z_][A-Za-z0-9_.-]*$/u
const WIKIDOT_RESERVED_PLAIN_SCALARS = /^(?:false|no|null|off|on|true|yes|~)$/iu

/**
 * @param {string} value
 * @returns {string}
 */
const serializeWikidotTextScalar = (value) => {
  if (value.includes("\n")) {
    return `"${value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("\n", "\\n")}"`
  }
  if (WIKIDOT_PLAIN_SCALAR.test(value) && !WIKIDOT_RESERVED_PLAIN_SCALARS.test(value)) {
    return value
  }
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * @param {string} value
 * @returns {string}
 */
const serializeWikidotSelectScalar = (value) => {
  if (value === "") return "null"
  if (WIKIDOT_PLAIN_SCALAR.test(value) && !WIKIDOT_RESERVED_PLAIN_SCALARS.test(value)) {
    return value
  }
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * @param {string} value
 * @returns {string}
 */
const serializeWikidotWikiScalar = (value) => {
  if (/^\/\S+$/u.test(value)) return value
  return serializeWikidotTextScalar(value)
}

const serializeWikidotUrlScalar = (value) => {
  if (WIKIDOT_BARE_URL.test(value)) {
    return value
  }
  return serializeWikidotTextScalar(value)
}

/**
 * Serializes the currently evidenced data-form fields in template order.
 *
 * @param {WikidotDataFormDefinition} definition
 * @param {Record<string, string>} values
 * @returns {string}
 */
export const serializeWikidotDataFormSource = (definition, values) => {
  if (definition.fields.length === 1 && definition.fields[0]?.field_type === "static") {
    return "null"
  }
  return definition.fields
    .map((field) => {
      const value = values[field.name] ?? ""
      const serialized =
        field.field_type === "hidden"
          ? serializeWikidotTextScalar(field.configured_value ?? "")
          : field.field_type === "static"
            ? "null"
            : field.field_type === "url"
              ? serializeWikidotUrlScalar(value)
              : field.field_type === "checkbox"
                ? values[field.name] === "1"
                  ? "'1'"
                  : "'0'"
                : field.field_type === "select"
                  ? serializeWikidotSelectScalar(value)
                  : field.field_type === "wiki"
                    ? serializeWikidotWikiScalar(value)
                    : serializeWikidotTextScalar(value)
      return `${field.name}: ${serialized}`
    })
    .join("\n")
}
