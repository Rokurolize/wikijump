import { deleteIssueAction, loadDeleteAccountPage } from "$lib/server/load/email-token"

export async function load({ request, parent }) {
  return loadDeleteAccountPage(request, parent)
}

export const actions = { default: deleteIssueAction }
