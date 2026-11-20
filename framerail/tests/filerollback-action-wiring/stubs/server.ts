type Call = { method: string; params: Record<string, unknown> }

export const calls: Call[] = []

export const client = {
  async request(method: string, params: Record<string, unknown>) {
    calls.push({ method, params })
    return { user_id: -1 }
  }
}

export default {
  page: { history: { revisionNumber: 0, limit: 100 } },
  translateStripKeys: []
}

export async function startBlobUpload() {
  return { presign_url: "http://localhost/presign", pending_blob_id: "stub-blob" }
}

export async function uploadToPresignUrl() {
  return {}
}

export async function superValidate(request: Request) {
  return { valid: true, data: await request.json() }
}

export function withFiles<T>(data: T) {
  return data
}

export function fail(status: number, data?: unknown) {
  return { status, data }
}

export function valibot<T>(schema: T) {
  return schema
}
