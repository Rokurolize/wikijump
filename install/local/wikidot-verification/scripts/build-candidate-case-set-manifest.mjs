#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import { runCliIfMain } from "../src/cli-entry.mjs"
import { CANDIDATE_CASE_SET_NAMES, CANDIDATE_CASE_SETS } from "../src/candidate-case-command.mjs"

const SCHEMA = "wikijump.candidate_case_set_manifest.v1"
const REGISTRY_REFERENCE = "install/local/wikidot-verification/src/candidate-case-command.mjs#candidateCaseSet"
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_OUTPUT = path.resolve(SCRIPT_DIRECTORY, "../../../../docs/development/candidate-case-set-manifest.json")
const CASE_ID = /^[A-Z][A-Z0-9_]+$/u

function usage() {
  return `Usage: node ${path.basename(process.argv[1])} [--output JSON] [--verify]\n`
}

function parseArgs(argv) {
  let output = DEFAULT_OUTPUT
  let verify = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === "--output") {
      const value = argv[++index]
      if (!value || value.startsWith("--")) throw new Error("--output requires a value")
      output = path.resolve(value)
    } else if (argument === "--verify") verify = true
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write(usage())
      process.exit(0)
    } else throw new Error(`unknown argument: ${argument}`)
  }
  return { output, verify }
}

export function buildCandidateCaseSetManifest() {
  const caseSets = []
  const aliases = []
  for (const name of CANDIDATE_CASE_SET_NAMES) {
    const registered = CANDIDATE_CASE_SETS[name]
    if (registered.aliasOf !== undefined) {
      aliases.push({
        name,
        alias_of: [...registered.aliasOf].sort((left, right) => left.localeCompare(right, "en")),
        case_ids: [...registered.caseIds],
      })
    } else {
      caseSets.push({ name, case_ids: [...registered.caseIds] })
    }
  }
  caseSets.sort((left, right) => left.name.localeCompare(right.name, "en"))
  aliases.sort((left, right) => left.name.localeCompare(right.name, "en"))
  return {
    schema: SCHEMA,
    registry: REGISTRY_REFERENCE,
    case_set_count: CANDIDATE_CASE_SET_NAMES.length,
    execution_case_set_count: caseSets.length,
    alias_case_set_count: aliases.length,
    case_sets: caseSets,
    aliases,
  }
}

const MANIFEST_FIELDS = "alias_case_set_count,aliases,case_set_count,case_sets,execution_case_set_count,registry,schema"

function requireRowFields(row, expectedFields, label) {
  if (typeof row !== "object" || row === null || Array.isArray(row)) throw new Error(`${label} must be an object`)
  if (Object.keys(row).sort().join(",") !== expectedFields.join(",")) {
    throw new Error(`${label} has unknown fields`)
  }
}

function requireCaseIds(name, caseIds, label) {
  if (
    !Array.isArray(caseIds) ||
    caseIds.length === 0 ||
    caseIds.some((caseId) => !CASE_ID.test(caseId)) ||
    new Set(caseIds).size !== caseIds.length
  ) {
    throw new Error(`${label} ${name} case_ids must be non-empty and unique`)
  }
}

export function verifyCandidateCaseSetManifest(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("candidate case set manifest must be an object")
  }
  if (Object.keys(value).sort().join(",") !== MANIFEST_FIELDS) {
    throw new Error("candidate case set manifest has unknown fields")
  }
  if (value.schema !== SCHEMA) throw new Error(`candidate case set manifest has an unknown schema: ${value.schema}`)
  if (value.registry !== REGISTRY_REFERENCE) throw new Error("candidate case set manifest binds an unknown registry")
  if (!Array.isArray(value.case_sets) || !Array.isArray(value.aliases)) {
    throw new Error("candidate case set manifest case_sets and aliases must be arrays")
  }

  const names = [...value.case_sets.map(({ name }) => name), ...value.aliases.map(({ name }) => name)].sort((left, right) => left.localeCompare(right, "en"))
  const registeredNames = [...CANDIDATE_CASE_SET_NAMES].sort((left, right) => left.localeCompare(right, "en"))
  if (JSON.stringify(names) !== JSON.stringify(registeredNames)) {
    throw new Error("candidate case set manifest omits, duplicates, or adds a registered case set")
  }
  if (value.case_set_count !== names.length) throw new Error("candidate case set manifest case_set_count is stale")
  if (value.execution_case_set_count !== value.case_sets.length) throw new Error("candidate case set manifest execution_case_set_count is stale")
  if (value.alias_case_set_count !== value.aliases.length) throw new Error("candidate case set manifest alias_case_set_count is stale")

  const owners = new Map()
  for (const row of value.case_sets) {
    requireRowFields(row, ["case_ids", "name"], "selected case set")
    if (typeof row.name !== "string" || row.name.length === 0) throw new Error("selected case set has an empty name")
    requireCaseIds(row.name, row.case_ids, "selected case set")
    for (const caseId of row.case_ids) {
      const existing = owners.get(caseId)
      if (existing !== undefined) {
        throw new Error(`duplicate candidate case ID across selected sets: ${caseId} owned by ${existing} and ${row.name}`)
      }
      owners.set(caseId, row.name)
    }
  }

  const selectedNames = new Set(value.case_sets.map(({ name }) => name))
  for (const row of value.aliases) {
    requireRowFields(row, ["alias_of", "case_ids", "name"], "alias case set")
    if (typeof row.name !== "string" || row.name.length === 0) throw new Error("alias case set has an empty name")
    if (selectedNames.has(row.name)) throw new Error(`case set is both selected and an alias: ${row.name}`)
    if (
      !Array.isArray(row.alias_of) ||
      row.alias_of.length === 0 ||
      new Set(row.alias_of).size !== row.alias_of.length ||
      row.alias_of.some((target) => !selectedNames.has(target))
    ) {
      throw new Error(`alias case set ${row.name} alias_of must name distinct selected sets`)
    }
    requireCaseIds(row.name, row.case_ids, "alias case set")
    const union = [...new Set(row.alias_of.flatMap((target) => value.case_sets.find(({ name }) => name === target).case_ids))].sort((left, right) => left.localeCompare(right, "en"))
    const aliasIds = [...row.case_ids].sort((left, right) => left.localeCompare(right, "en"))
    if (JSON.stringify(aliasIds) !== JSON.stringify(union)) {
      throw new Error(`alias case set ${row.name} case_ids do not match the union of its owners`)
    }
  }
  return true
}

async function main(argv) {
  const options = parseArgs(argv)
  const manifest = `${JSON.stringify(buildCandidateCaseSetManifest(), null, 2)}\n`
  if (options.verify) {
    let actual
    try {
      actual = await fs.readFile(options.output, "utf8")
    } catch (error) {
      throw new Error(`cannot read candidate case set manifest ${options.output}: ${error.message}`)
    }
    if (actual !== manifest) throw new Error(`candidate case set manifest is stale: ${options.output}`)
    const parsed = JSON.parse(manifest)
    verifyCandidateCaseSetManifest(parsed)
    process.stdout.write(`verified ${parsed.case_set_count} candidate case sets (${parsed.execution_case_set_count} execution, ${parsed.alias_case_set_count} alias)\n`)
    return 0
  }
  verifyCandidateCaseSetManifest(JSON.parse(manifest))
  await fs.mkdir(path.dirname(options.output), { recursive: true })
  await fs.writeFile(options.output, manifest)
  const parsed = JSON.parse(manifest)
  process.stdout.write(`wrote ${parsed.case_set_count} candidate case sets (${parsed.execution_case_set_count} execution, ${parsed.alias_case_set_count} alias) to ${options.output}\n`)
  return 0
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(`candidate case set manifest failed: ${error?.message ?? String(error)}`)
    return 2
  },
})
