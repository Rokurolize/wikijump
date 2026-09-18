import { extractBalanced, splitTopLevel } from "./typescript-source.mjs"

function uniqueSortedStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value !== ""))].sort()
}

function stringConstant(sourceText, name, reference) {
  const match = new RegExp(`const\\s+${name}\\s*=\\s*["']([^"']+)["']`, "u").exec(sourceText)
  if (!match) throw new Error(`missing ${name} in ${reference}`)
  return match[1]
}

function stringSet(sourceText, name, reference) {
  const marker = new RegExp(`const\\s+${name}\\s*=\\s*new\\s+Set\\s*\\(`, "u").exec(sourceText)
  if (!marker) throw new Error(`missing ${name} in ${reference}`)
  const expressionStart = marker.index + marker[0].length - 1
  const expression = extractBalanced(sourceText, expressionStart, "(", ")")
  return [...expression.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1])
}

function moduleMapShapes(sourceText, constantName, reference) {
  const marker = new RegExp(
    `const\\s+${constantName}\\s*=\\s*new\\s+Map\\s*\\(`,
    "u"
  ).exec(sourceText)
  if (!marker) throw new Error(`missing ${constantName} in ${reference}`)
  const mapStart = marker.index + marker[0].length - 1
  const mapExpression = extractBalanced(sourceText, mapStart, "(", ")")
  const arrayStart = mapExpression.indexOf("[")
  if (arrayStart < 0) throw new Error(`module registry is not an array in ${reference}`)
  const entriesExpression = extractBalanced(mapExpression, arrayStart, "[", "]")
  const shapes = []
  for (const entry of splitTopLevel(entriesExpression.slice(1, -1))) {
    const moduleName = entry.match(/^\[\s*["']([^"']+)["']/u)?.[1]
    if (!moduleName) throw new Error(`unsupported module entry in ${constantName}: ${entry}`)
    const parameterSets = [...entry.matchAll(/new\s+Set\s*\(([^)]*)\)/gu)]
    if (parameterSets.length === 0) throw new Error(`module has no parameter shape: ${moduleName}`)
    for (const parameterSet of parameterSets) {
      const parameters = [...parameterSet[1].matchAll(/["']([^"']+)["']/gu)]
        .map((match) => match[1])
        .sort()
      shapes.push({ moduleName, parameters })
    }
  }
  return shapes
}

function amcModuleSurface(surface, registryPath, moduleName, parameters, selector = "parameters") {
  const shape = parameters.length === 0 ? "(none)" : parameters.join(",")
  return surface({
    surfaceId: `framerail-amc-module:${moduleName}:${selector}=${shape}`,
    kind: "framerail_amc_module_shape",
    publicOwner: "framerail",
    publicReference: [`${registryPath}#module:${moduleName};${selector}=${shape}`]
  })
}


export async function discoverFramerailAmc(root, { readText, readJson, surface }) {
  const registryPath = "framerail/src/lib/server/ajax-module-connector.js"
  const wireContractPath = "docs/development/framerail-amc-wire-contracts.json"
  const sourceText = await readText(root, registryPath)
  const wireContract = await readJson(root, wireContractPath)
  if (wireContract.schema !== "wikijump.framerail_amc_wire_contracts.v1") {
    throw new Error(`unknown Framerail AMC wire contract schema: ${wireContract.schema}`)
  }
  if (!Array.isArray(wireContract.modules)) {
    throw new Error(`${wireContractPath} modules must be an array`)
  }
  const siteChangesClassifierPath =
    "framerail/src/lib/server/wikidot-site-changes.js"
  const siteChangesClassifierText = await readText(root, siteChangesClassifierPath)
  const records = moduleMapShapes(
    sourceText,
    "FORUM_READ_MODULE_PARAMETERS",
    registryPath
  ).map(({ moduleName, parameters }) => amcModuleSurface(surface, registryPath, moduleName, parameters))
  for (const { moduleName, parameters } of moduleMapShapes(
    sourceText,
    "PAGE_READ_MODULE_PARAMETERS",
    registryPath
  )) {
    records.push(amcModuleSurface(surface, registryPath, moduleName, parameters))
  }
  const siteChangesModule = stringConstant(sourceText, "SITE_CHANGES_MODULE", registryPath)
  for (const fieldSet of ["BROWSER_FIELDS", "WIKIDOT_PY_FIELDS"]) {
    records.push(
      amcModuleSurface(
        surface,
        siteChangesClassifierPath,
        siteChangesModule,
        stringSet(siteChangesClassifierText, fieldSet, siteChangesClassifierPath).sort()
      )
    )
  }
  const membersListModule = stringConstant(sourceText, "MEMBERS_LIST_MODULE", registryPath)
  records.push(
    amcModuleSurface(
      surface,
      registryPath,
      membersListModule,
      stringSet(sourceText, "MEMBERS_LIST_PARAMETERS", registryPath).sort()
    )
  )
  records.push(
    amcModuleSurface(
      surface,
      registryPath,
      membersListModule,
      stringSet(sourceText, "MEMBERS_LIST_DEFAULT_PARAMETERS", registryPath).sort()
    )
  )
  const listPagesModule = sourceText.match(/moduleName\s*!==\s*["']([^"']*ListPagesModule)["']/u)?.[1]
  if (!listPagesModule) throw new Error(`missing ListPages module allowlist entry in ${registryPath}`)
  const listPagesContract = wireContract.modules.find(
    ({ module_name: moduleName }) => moduleName === listPagesModule
  )
  if (!listPagesContract) {
    throw new Error(`${wireContractPath} has no contract for ${listPagesModule}`)
  }
  const sourceParameters = stringSet(sourceText, "LIST_PAGES_PARAMETERS", registryPath).sort()
  const contractParameters = uniqueSortedStrings(listPagesContract.allowed_parameters ?? [])
  if (
    contractParameters.length !== listPagesContract.allowed_parameters?.length ||
    JSON.stringify(contractParameters) !== JSON.stringify(sourceParameters)
  ) {
    throw new Error(`${wireContractPath} ${listPagesModule} allowed_parameters do not match source`)
  }
  if (JSON.stringify(listPagesContract.required_fields) !== JSON.stringify([])) {
    throw new Error(`${wireContractPath} ${listPagesModule} must not require fields`)
  }
  if (listPagesContract.module_body !== "optional_default_template") {
    throw new Error(`${wireContractPath} ${listPagesModule} must default an omitted module_body`)
  }
  records.push(
    surface({
      surfaceId: `framerail-amc-module:${listPagesModule}:parameters=${contractParameters.join(",")};module_body=${listPagesContract.module_body}`,
      kind: "framerail_amc_module_shape",
      publicOwner: "framerail",
      publicReference: [wireContractPath, registryPath, ...listPagesContract.implementation_references]
    })
  )
  for (const [field, selector] of [
    ["parameter_order", "parameter-order"],
    ["duplicate_fields", "duplicate-fields"],
    ["unknown_parameters", "unknown-parameters"],
    ["value_type", "value-type"],
    ["callback_index", "callback-index"],
    ["authentication", "authentication"],
    ["success_envelope", "success-envelope"]
  ]) {
    const value = listPagesContract[field]
    if (typeof value !== "string" || value === "") {
      throw new Error(`${wireContractPath} ${listPagesModule} has invalid ${field}`)
    }
    records.push(
      surface({
        surfaceId: `framerail-amc-module:${listPagesModule}:${selector}=${value}`,
        kind: "framerail_amc_module_shape",
        publicOwner: "framerail",
        publicReference: [wireContractPath, registryPath, ...listPagesContract.implementation_references]
      })
    )
  }
  if (
    !Array.isArray(listPagesContract.failure_envelopes) ||
    listPagesContract.failure_envelopes.length === 0 ||
    listPagesContract.failure_envelopes.some((value) => typeof value !== "string" || value === "")
  ) {
    throw new Error(`${wireContractPath} ${listPagesModule} has invalid failure_envelopes`)
  }
  records.push(
    surface({
      surfaceId: `framerail-amc-module:${listPagesModule}:failure-envelopes=${listPagesContract.failure_envelopes.join("|")}`,
      kind: "framerail_amc_module_shape",
      publicOwner: "framerail",
      publicReference: [wireContractPath, registryPath, ...listPagesContract.implementation_references]
    })
  )

  for (const [actionName, eventName] of [
    ["NEWPAGE_ACTION", "NEWPAGE_EVENT"],
    ["PAGE_DISCUSSION_ACTION", "PAGE_DISCUSSION_EVENT"]
  ]) {
    const action = stringConstant(sourceText, actionName, registryPath)
    const event = stringConstant(sourceText, eventName, registryPath)
    records.push(
      surface({
        surfaceId: `framerail-amc-action:${action}:${event}`,
        kind: "framerail_amc_action_shape",
        publicOwner: "framerail",
        publicReference: [`${registryPath}#action:${action};event=${event}`]
      })
    )
  }
  return records
}

