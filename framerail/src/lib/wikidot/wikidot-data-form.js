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
 * }} WikidotDataFormField
 */

/**
 * @typedef {{
 *   fields: WikidotDataFormField[]
 * }} WikidotDataFormDefinition
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
    definition.fields.map((field) => [
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

/**
 * Serializes the currently evidenced text and select fields in template
 * order.
 *
 * @param {WikidotDataFormDefinition} definition
 * @param {Record<string, string>} values
 * @returns {string}
 */
export const serializeWikidotDataFormSource = (definition, values) => {
  return definition.fields
    .map((field) => {
      const value = values[field.name] ?? ""
      const serialized =
        field.field_type === "checkbox"
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
