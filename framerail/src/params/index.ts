import { defineParams } from "@sveltejs/kit/params"

export const params = defineParams({
  id: (param) => (/^\d+$/.test(param) ? param : undefined)
})
