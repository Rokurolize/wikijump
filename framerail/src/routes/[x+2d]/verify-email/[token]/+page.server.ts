import { loadVerifyTokenPage, verifyRedeemAction } from "$lib/server/load/email-token"

export async function load({ request, parent, params }) {
  return loadVerifyTokenPage(request, parent, params.token)
}

export const actions = { default: verifyRedeemAction }
