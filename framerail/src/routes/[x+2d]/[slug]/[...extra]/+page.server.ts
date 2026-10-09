import { error } from "@sveltejs/kit"

import type { PageServerLoad } from "./$types"

// Unknown /-/ platform paths are not pages. Answer with a real 404 so crawlers
// and non-JavaScript clients see the status, instead of a 200 followed by a
// client-side navigation to the home page.
export const load: PageServerLoad = () => error(404)
