export function extractBalanced(sourceText, start, openCharacter, closeCharacter) {
  if (sourceText[start] !== openCharacter) {
    throw new Error(`expected ${openCharacter} at registry expression offset ${start}`)
  }
  let depth = 0
  let quote = null
  let escaped = false
  for (let index = start; index < sourceText.length; index += 1) {
    const character = sourceText[index]
    if (quote !== null) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character
      continue
    }
    if (character === openCharacter) depth += 1
    else if (character === closeCharacter) {
      depth -= 1
      if (depth === 0) return sourceText.slice(start, index + 1)
    }
  }
  throw new Error(`unterminated ${openCharacter}${closeCharacter} registry expression`)
}

export function splitTopLevel(sourceText) {
  const entries = []
  let start = 0
  let quote = null
  let escaped = false
  const depths = { "(": 0, "[": 0, "{": 0 }
  const closing = { ")": "(", "]": "[", "}": "{" }
  for (let index = 0; index < sourceText.length; index += 1) {
    const character = sourceText[index]
    if (quote !== null) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character
      continue
    }
    if (Object.hasOwn(depths, character)) depths[character] += 1
    else if (Object.hasOwn(closing, character)) depths[closing[character]] -= 1
    else if (character === "," && Object.values(depths).every((depth) => depth === 0)) {
      entries.push(sourceText.slice(start, index).trim())
      start = index + 1
    }
  }
  const finalEntry = sourceText.slice(start).trim()
  if (finalEntry !== "") entries.push(finalEntry)
  return entries
}

export function objectPropertyNames(objectExpression, declaration) {
  const body = objectExpression.slice(1, -1)
  return splitTopLevel(body).map((entry) => {
    const match = entry.match(/^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][A-Za-z0-9_$]*))\s*:/u)
    if (!match) throw new Error(`unsupported property in ${declaration}: ${entry}`)
    return match[1] ?? match[2] ?? match[3]
  })
}

export function maskTypeScriptCommentsAndLiterals(sourceText, reference) {
  const masked = sourceText.split("")
  const blank = (start, end) => {
    for (let index = start; index < end; index += 1) {
      if (masked[index] !== "\n" && masked[index] !== "\r") masked[index] = " "
    }
  }
  let index = 0
  while (index < sourceText.length) {
    if (sourceText.startsWith("//", index)) {
      const newline = sourceText.indexOf("\n", index + 2)
      const end = newline < 0 ? sourceText.length : newline
      blank(index, end)
      index = end
      continue
    }
    if (sourceText.startsWith("/*", index)) {
      const close = sourceText.indexOf("*/", index + 2)
      if (close < 0) throw new Error(`${reference} contains an unterminated block comment`)
      const end = close + 2
      blank(index, end)
      index = end
      continue
    }
    const quote = sourceText[index]
    if (quote === '"' || quote === "'" || quote === "`") {
      let cursor = index + 1
      let escaped = false
      while (cursor < sourceText.length) {
        const character = sourceText[cursor]
        if (escaped) escaped = false
        else if (character === "\\") escaped = true
        else if (character === quote) break
        cursor += 1
      }
      if (cursor >= sourceText.length) {
        throw new Error(`${reference} contains an unterminated TypeScript literal`)
      }
      blank(index + 1, cursor)
      index = cursor + 1
      continue
    }
    index += 1
  }
  return masked.join("")
}


export function importedBinding(sourceText, localName) {
  for (const match of sourceText.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/gu)) {
    for (const binding of match[1].split(",")) {
      const parts = binding.trim().split(/\s+as\s+/u)
      const imported = parts[0]?.trim()
      const local = (parts[1] ?? parts[0])?.trim()
      if (local === localName) return { imported, specifier: match[2] }
    }
  }
  return null
}

