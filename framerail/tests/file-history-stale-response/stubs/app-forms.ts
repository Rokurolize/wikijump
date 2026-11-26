export function deserialize<T, E>(text: string): { type: string; data?: T | E } {
  return JSON.parse(text)
}
