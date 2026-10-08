import { redirect } from "@sveltejs/kit"

import type { PageServerLoad } from "./$types"

// The bare /-/ prefix is not a platform page. Send it home with a real HTTP
// redirect rather than a 200 followed by client-side navigation.
export const load: PageServerLoad = () => redirect(302, "/")
