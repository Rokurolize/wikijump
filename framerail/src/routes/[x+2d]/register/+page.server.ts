import { loadRegisterPage, registerAction } from "$lib/server/load/register"
import { redirect } from "@sveltejs/kit"

export async function load({ request, parent }) {
  const data = await loadRegisterPage(request, parent)
  if (data.isLoggedIn) redirect(303, "/")
  return data
}

export const actions = { default: registerAction }
