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
        : (field.default_value ?? "")
    ])
  )
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
        field.field_type === "select" ? value : `'${value.replaceAll("'", "''")}'`
      return `${field.name}: ${serialized}`
    })
    .join("\n")
}
