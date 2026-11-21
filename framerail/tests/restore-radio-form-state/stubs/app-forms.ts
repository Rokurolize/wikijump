export function deserialize<T, E = T>(text: string): { type: string; data?: T | E } {
  return JSON.parse(text)
}
