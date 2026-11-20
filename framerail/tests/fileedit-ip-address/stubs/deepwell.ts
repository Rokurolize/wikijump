type Call = { method: string; params: Record<string, unknown> }

export const calls: Call[] = []

export const client = {
  async request(method: string, params: Record<string, unknown>) {
    calls.push({ method, params })
    if (method === "file_edit" && typeof params.ip_address !== "string") {
      throw new Error("missing field ip_address")
    }
    return { file_id: 88, file_revision_id: 109 }
  }
}
