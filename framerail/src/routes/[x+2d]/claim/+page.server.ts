import {
  claimAction,
  loadClaimPage,
  startProfileChallengeAction,
  verifyProfileChallengeAction
} from "$lib/server/load/claim"
import { redirect } from "@sveltejs/kit"

export async function load({ request, parent, url }) {
  const data = await loadClaimPage(request, parent, url)
  if (data.isLoggedIn) redirect(303, "/")
  return data
}

export const actions = {
  default: claimAction,
  startChallenge: startProfileChallengeAction,
  verifyChallenge: verifyProfileChallengeAction
}
