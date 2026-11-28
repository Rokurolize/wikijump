export type PropertiesStep = "content" | "parent"
export type PropertyErrorStep = PropertiesStep | "tags"

export interface ParentChange {
  add: string[]
  remove: string[]
}

export interface PropertiesErrors {
  tags: string | null
  parent: string | null
}

export interface PropertiesReport {
  state: "idle" | "invalid" | "saving" | "saved" | "partial" | "failed"
  step?: PropertiesStep
  message: string
}

export interface PropertyActionError {
  code?: number
  status?: number
  data?: unknown
}

export const IDLE_PROPERTIES_REPORT: PropertiesReport = {
  state: "idle",
  message: ""
}

export const splitSpaceSeparated = (value: string): string[] =>
  value.split(/\s+/u).filter((token) => token.length > 0)

export const diffParents = (current: string[], next: string[]): ParentChange => ({
  add: next.filter((parent) => !current.includes(parent)),
  remove: current.filter((parent) => !next.includes(parent))
})

const PARENT_SLUG = /^[a-z0-9][a-z0-9_-]*(?::[a-z0-9][a-z0-9_-]*)?$/u
const MAX_PARENT_UPDATES = 64

export const validateParentValue = (value: string, selfSlug?: string): string | null => {
  const parents = splitSpaceSeparated(value)
  if (parents.length > MAX_PARENT_UPDATES) {
    return `Choose at most ${MAX_PARENT_UPDATES} parent pages.`
  }
  for (const parent of parents) {
    if (!PARENT_SLUG.test(parent)) {
      return `“${parent}” is not a valid page name. Use category:page with lowercase letters, digits, hyphens, and underscores.`
    }
    if (selfSlug && parent === selfSlug) {
      return "A page cannot be its own parent. Choose another page or clear the field."
    }
  }
  return null
}

export const validateTagsValue = (value: string): string | null => {
  for (const tag of splitSpaceSeparated(value)) {
    if (tag.includes(",")) {
      return `Remove the comma from “${tag}”. Separate tags with spaces, for example "alpha beta".`
    }
    if (tag.includes("[") || tag.includes("]")) {
      return `Remove square brackets from “${tag}”. Tags are plain labels.`
    }
  }
  return null
}

export const validateProperties = (input: {
  tags: string
  parent: string
  selfSlug?: string
  parentReady?: boolean
}): PropertiesErrors => ({
  tags: validateTagsValue(input.tags),
  parent:
    input.parentReady === false ? null : validateParentValue(input.parent, input.selfSlug)
})

export const hasPropertyErrors = (errors: PropertiesErrors): boolean =>
  errors.tags !== null || errors.parent !== null

export const firstPropertyError = (errors: PropertiesErrors): string | null =>
  errors.tags ?? errors.parent

export const classifyPropertyActionError = (
  error: PropertyActionError,
  step: PropertyErrorStep
): string => {
  if (error.status === 401) {
    return "Sign in to save page properties, then try again."
  }
  if (error.status === 403 || error.code === 3106) {
    return step === "parent"
      ? "You do not have permission to change this page's parent. Ask a site administrator for edit permission, then try again."
      : "You do not have permission to edit this page."
  }
  switch (error.code) {
    case 1308:
      return "That parent change is not allowed because it would create a cycle or repeat an existing parent. Choose a different page."
    case 2007:
      return "The parent page does not exist. Check the name and use category:page."
    case 2005:
      return "That page no longer exists. Reload the editor and try again."
    case 4300:
      return "The parent name is empty. Enter a page name, or clear the field to remove the parent."
    case 4000:
      return step === "tags"
        ? "The tag list was rejected. Use space-separated tags without commas or square brackets."
        : "The parent name is invalid. Use a page name such as category:page."
    default:
      return step === "parent"
        ? `The page-tree move could not be applied (code ${error.code ?? "unknown"}). Check the parent page and try again.`
        : `The page properties could not be saved (code ${error.code ?? "unknown"}). Try saving again.`
  }
}

export const parentReportMessage = (savedContent: boolean, reason: string): string =>
  savedContent
    ? `Page source, title, tags, and revision comments were saved. The page-tree move was not applied. ${reason} Fix the parent field and use Retry page-tree move; only the move will be repeated.`
    : `Nothing was saved. ${reason}`
