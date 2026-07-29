/// <reference lib="webworker" />

const workerScope = self as DedicatedWorkerGlobalScope

type MatchField = {
  name: string
  pattern: string
  value: string
}

const normalizeExtendedPattern = (pattern: string) => {
  let output = ""
  let escaped = false
  let inCharacterClass = false
  let inComment = false
  for (const character of pattern) {
    if (inComment) {
      if (character === "\n" || character === "\r") inComment = false
      continue
    }
    if (escaped) {
      output += character
      escaped = false
      continue
    }
    if (character === "\\") {
      output += character
      escaped = true
      continue
    }
    if (character === "[" && !inCharacterClass) {
      inCharacterClass = true
      output += character
      continue
    }
    if (character === "]" && inCharacterClass) {
      inCharacterClass = false
      output += character
      continue
    }
    if (!inCharacterClass && character === "#") {
      inComment = true
      continue
    }
    if (!inCharacterClass && /\s/u.test(character)) continue
    output += character
  }
  return output
}

workerScope.onmessage = ({ data }: MessageEvent<{ fields: MatchField[] }>) => {
  const results: { name: string; matches: boolean }[] = []
  for (const field of data.fields) {
    const delimitedPattern = /^\/([\s\S]*)\/([a-z]*)$/u.exec(field.pattern)
    if (!delimitedPattern) {
      results.push({ name: field.name, matches: false })
      continue
    }
    const flags = delimitedPattern[2]
    if ([...flags].some((flag) => !"imsux".includes(flag))) {
      results.push({ name: field.name, matches: false })
      continue
    }
    try {
      const javascriptFlags = [...new Set(flags.replaceAll("x", ""))]
        .filter((flag) => "imsu".includes(flag))
        .join("")
      const pattern = flags.includes("x")
        ? normalizeExtendedPattern(delimitedPattern[1])
        : delimitedPattern[1]
      results.push({
        name: field.name,
        matches: new RegExp(pattern, javascriptFlags).test(field.value)
      })
    } catch {
      workerScope.postMessage({ kind: "invalid", name: field.name })
      return
    }
  }
  workerScope.postMessage({ kind: "complete", results })
}
