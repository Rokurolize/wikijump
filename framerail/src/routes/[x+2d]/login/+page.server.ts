import { loadLoginPage, loginAction } from "$lib/server/load/login"

export async function load({ request, parent, cookies }) {
  return loadLoginPage(request, parent, cookies)
}

export const actions = { default: loginAction }
