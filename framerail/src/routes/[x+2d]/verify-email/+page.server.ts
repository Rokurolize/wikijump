import { loadVerifyPage, verifyIssueAction } from "$lib/server/load/email-token"

export async function load({ request, parent }) {
  return loadVerifyPage(request, parent)
}

export const actions = { default: verifyIssueAction }
