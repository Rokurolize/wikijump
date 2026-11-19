type Call = { method: string; params: Record<string, unknown> }

export const calls: Call[] = []

export const client = {
  async request(method: string, params: Record<string, unknown>) {
    calls.push({ method, params })
    return { file_id: 88, file_revision_id: 109 }
  }
}
