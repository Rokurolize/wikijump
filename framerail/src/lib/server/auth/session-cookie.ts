import type { Cookies } from "@sveltejs/kit"

export function deleteSessionCookie(cookies: Cookies) {
  cookies.delete("wikijump_token", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax"
  })
}
