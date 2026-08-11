export function pageMutationDestinationSlug({
  creating,
  requestedSlug,
  responseSlug
}: {
  creating: boolean
  requestedSlug: string
  responseSlug?: string
}): string | null {
  if (!creating) return requestedSlug
  return responseSlug && responseSlug.length > 0 ? responseSlug : null
}
