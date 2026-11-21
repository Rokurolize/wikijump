export async function superValidate(request: Request) {
  return { valid: true, data: await request.json() }
}

export function withFiles<T>(data: T) {
  return data
}

export function fail(status: number, data?: unknown) {
  return { status, data }
}
