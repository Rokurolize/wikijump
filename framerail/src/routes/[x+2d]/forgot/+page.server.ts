import { forgotAction, loadForgotPage } from "$lib/server/load/email-token"

export async function load({ request, parent }) {
  return loadForgotPage(request, parent)
}

export const actions = { default: forgotAction }
