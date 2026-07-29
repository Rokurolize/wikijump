/// <reference lib="webworker" />

const workerScope = self as DedicatedWorkerGlobalScope

type MatchField = {
  name: string
  pattern: string
  value: string
}

workerScope.onmessage = ({ data }: MessageEvent<{ fields: MatchField[] }>) => {
  const results: { name: string; matches: boolean }[] = []
  for (const field of data.fields) {
    const delimitedPattern = /^\/([\s\S]*)\/([a-z]*)$/u.exec(field.pattern)
    if (!delimitedPattern) {
      workerScope.postMessage({ kind: "invalid", name: field.name })
      return
    }
    try {
      results.push({
        name: field.name,
        matches: new RegExp(delimitedPattern[1], delimitedPattern[2]).test(field.value)
      })
    } catch {
      workerScope.postMessage({ kind: "invalid", name: field.name })
      return
    }
  }
  workerScope.postMessage({ kind: "complete", results })
}
