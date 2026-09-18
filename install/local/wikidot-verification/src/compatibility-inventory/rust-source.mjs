const RUST_DELIMITER_PAIRS = new Map([["(", ")"], ["[", "]"], ["{", "}"]])

export function scanRustTokens(sourceText, reference) {
  const tokens = []
  let index = 0
  while (index < sourceText.length) {
    const character = sourceText[index]
    if (/\s/u.test(character)) {
      index += 1
      continue
    }
    if (sourceText.startsWith("//", index)) {
      const newline = sourceText.indexOf("\n", index + 2)
      index = newline < 0 ? sourceText.length : newline + 1
      continue
    }
    if (sourceText.startsWith("/*", index)) {
      let depth = 1
      let cursor = index + 2
      while (cursor < sourceText.length && depth > 0) {
        if (sourceText.startsWith("/*", cursor)) {
          depth += 1
          cursor += 2
        } else if (sourceText.startsWith("*/", cursor)) {
          depth -= 1
          cursor += 2
        } else {
          cursor += 1
        }
      }
      if (depth !== 0) throw new Error(`${reference} contains an unterminated block comment`)
      index = cursor
      continue
    }

    const rawString = /^(?:b|c)?r(#+)?"/u.exec(sourceText.slice(index))
    if (rawString) {
      const hashes = rawString[1] ?? ""
      const contentStart = index + rawString[0].length
      const terminator = `"${hashes}`
      const end = sourceText.indexOf(terminator, contentStart)
      if (end < 0) throw new Error(`${reference} contains an unterminated raw string`)
      tokens.push({
        kind: "string",
        value: sourceText.slice(contentStart, end)
      })
      index = end + terminator.length
      continue
    }

    const stringPrefixLength = (character === "b" || character === "c") && sourceText[index + 1] === '"' ? 1 : 0
    if (character === '"' || stringPrefixLength === 1) {
      const quote = index + stringPrefixLength
      let cursor = quote + 1
      let escaped = false
      while (cursor < sourceText.length) {
        const current = sourceText[cursor]
        if (escaped) escaped = false
        else if (current === "\\") escaped = true
        else if (current === '"') break
        cursor += 1
      }
      if (cursor >= sourceText.length) throw new Error(`${reference} contains an unterminated string`)
      tokens.push({
        kind: "string",
        value: sourceText.slice(quote + 1, cursor)
      })
      index = cursor + 1
      continue
    }

    if (character === "'") {
      let cursor = index + 1
      if (sourceText[cursor] === "\\") {
        cursor += 1
        if (sourceText[cursor] === "u" && sourceText[cursor + 1] === "{") {
          const unicodeClose = sourceText.indexOf("}", cursor + 2)
          cursor = unicodeClose < 0 ? sourceText.length : unicodeClose + 1
        } else if (sourceText[cursor] === "x") {
          cursor += 3
        } else {
          cursor += 1
        }
      } else {
        const codePoint = sourceText.codePointAt(cursor)
        if (codePoint !== undefined) cursor += String.fromCodePoint(codePoint).length
      }
      if (sourceText[cursor] === "'") {
        tokens.push({ kind: "character", value: "" })
        index = cursor + 1
      } else {
        tokens.push({ kind: "punctuation", value: character })
        index += 1
      }
      continue
    }

    const identifier = /^[A-Za-z_][A-Za-z0-9_]*/u.exec(sourceText.slice(index))
    if (identifier) {
      tokens.push({
        kind: "identifier",
        value: identifier[0]
      })
      index += identifier[0].length
      continue
    }
    tokens.push({ kind: "punctuation", value: character })
    index += 1
  }
  return tokens
}

export function productionRustTokens(tokens, reference) {
  const testAttribute = ["#", "[", "cfg", "(", "test", ")", "]"]
  const production = []
  for (let index = 0; index < tokens.length;) {
    if (testAttribute.every((value, offset) => tokens[index + offset]?.value === value)) {
      const moduleIndex = index + testAttribute.length
      if (tokens[moduleIndex]?.value !== "mod" || tokens[moduleIndex + 1]?.kind !== "identifier") {
        throw new Error(`${reference} contains an unsupported cfg(test) item`)
      }
      const moduleBodyIndex = moduleIndex + 2
      if (tokens[moduleBodyIndex]?.value === ";") {
        index = moduleBodyIndex + 1
        continue
      }
      if (tokens[moduleBodyIndex]?.value !== "{") {
        throw new Error(`${reference} contains an unsupported cfg(test) item`)
      }
      index = matchingRustDelimiter(tokens, moduleBodyIndex, reference) + 1
      continue
    }
    production.push(tokens[index])
    index += 1
  }
  return production
}

export function matchingRustDelimiter(tokens, openIndex, reference) {
  const expectedClose = RUST_DELIMITER_PAIRS.get(tokens[openIndex]?.value)
  if (!expectedClose) throw new Error(`${reference} contains an unsupported route declaration`)
  const stack = [expectedClose]
  for (let index = openIndex + 1; index < tokens.length; index += 1) {
    const value = tokens[index].value
    const close = RUST_DELIMITER_PAIRS.get(value)
    if (close) stack.push(close)
    else if ([")", "]", "}"].includes(value)) {
      if (value !== stack.at(-1)) {
        throw new Error(`${reference} contains an unbalanced route declaration`)
      }
      stack.pop()
      if (stack.length === 0) return index
    }
  }
  throw new Error(`${reference} contains an unterminated route declaration`)
}

export function splitRustArguments(tokens, reference) {
  const argumentsList = []
  let start = 0
  const stack = []
  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value
    const close = RUST_DELIMITER_PAIRS.get(value)
    if (close) stack.push(close)
    else if ([")", "]", "}"].includes(value)) {
      if (value !== stack.at(-1)) {
        throw new Error(`${reference} contains an unbalanced route declaration`)
      }
      stack.pop()
    } else if (value === "," && stack.length === 0) {
      argumentsList.push(tokens.slice(start, index))
      start = index + 1
    }
  }
  if (stack.length !== 0) throw new Error(`${reference} contains an unbalanced route declaration`)
  argumentsList.push(tokens.slice(start))
  if (argumentsList.at(-1).length === 0) argumentsList.pop()
  return argumentsList
}

export function rustPath(tokens) {
  if (tokens.length === 0 || tokens[0].kind !== "identifier") return null
  let value = tokens[0].value
  for (let index = 1; index < tokens.length; index += 3) {
    if (
      tokens[index]?.value !== ":" ||
      tokens[index + 1]?.value !== ":" ||
      tokens[index + 2]?.kind !== "identifier"
    ) {
      return null
    }
    value += `::${tokens[index + 2].value}`
  }
  return value
}

