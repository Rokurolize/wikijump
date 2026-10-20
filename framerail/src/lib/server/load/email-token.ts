import defaults from "$lib/defaults"

import {
  emailVerifyIssue,
  emailVerifyRedeem,
  passwordResetComplete,
  passwordResetIssue,
  passwordResetRedeem
} from "$lib/server/deepwell/email-token"
import { translate } from "$lib/server/deepwell/translate"
import { resolveClientIp } from "$lib/server/client-ip.js"
import { failForActionError } from "$lib/server/load/action-error"
import {
  clearRegisterPasswords,
  redactAuthActionPayload
} from "$lib/server/load/auth-form-redaction.js"
import {
  isEmailTokenWellFormed,
  normalizeLookupEmail
} from "$lib/server/load/email-token-validation.js"
import { loadSiteInfo } from "$lib/server/load/site-info"
import { fail } from "@sveltejs/kit"
import { superValidate } from "sveltekit-superforms"
import { valibot } from "sveltekit-superforms/adapters"
import {
  email as emailRule,
  forward,
  minLength,
  object,
  partialCheck,
  pipe,
  string,
  transform
} from "valibot"

import type { PreloadDataAsync } from "$lib/server/deepwell/views"
import type { TranslateKeys } from "$lib/types"
import type { RequestEvent } from "@sveltejs/kit"

// A token that fails the shared shape contract can never redeem, so it is
// rejected with the same failure the backend would return, without an RPC.
// The body is built lazily: clearing password fields must never run on the
// success path.
function failForMalformedToken(token: unknown, buildBody: () => Record<string, unknown>) {
  if (!isEmailTokenWellFormed(token)) {
    return fail(400, {
      ...buildBody(),
      message: "The email token is invalid or expired"
    })
  }
  return null
}

// The backend trims surrounding whitespace before lookup, so the form
// accepts a pasted padded address and normalizes it the same way.
const emailSchema = object({
  email: pipe(
    string(),
    transform((value) => value.trim()),
    emailRule(),
    minLength(1)
  )
})

const tokenSchema = object({
  token: pipe(string(), minLength(1))
})

const newPasswordSchema = pipe(
  object({
    grant: pipe(string(), minLength(1)),
    password: pipe(string(), minLength(1)),
    confirmPassword: pipe(string(), minLength(1))
  }),
  forward(
    partialCheck(
      [["password"], ["confirmPassword"]],
      ({ password, confirmPassword }) => password === confirmPassword,
      "Passwords do not match"
    ),
    ["confirmPassword"]
  )
)

async function loadEmailTokenCopy(
  request: Request,
  preloadData: PreloadDataAsync,
  translateKeys: TranslateKeys
) {
  loadSiteInfo(request.headers)

  const parentData = await preloadData()
  const internationalization = await translate(parentData.locales, {
    ...defaults.translateKeys,
    ...translateKeys
  })

  return { internationalization }
}

// --- Forgot password (recovery issue) ---

export async function loadForgotPage(request: Request, preloadData: PreloadDataAsync) {
  const copy = await loadEmailTokenCopy(request, preloadData, {
    "password-recovery": {},
    "password-recovery.email-sent": {},
    "email": {},
    "send": {}
  })
  const forgotForm = await superValidate(valibot(emailSchema))
  return { ...copy, forgotForm, sent: false }
}

export async function forgotAction({ request, getClientAddress }: RequestEvent) {
  const ipAddress: string = resolveClientIp(request, getClientAddress())
  const form = await superValidate(request, valibot(emailSchema))

  if (!form.valid) {
    return fail(400, { form })
  }

  // The backend answers identically whether or not an account holds the
  // address, so success here never signals account existence.
  try {
    await passwordResetIssue(
      { email: normalizeLookupEmail(form.data.email), ipAddress },
      {}
    )
    return { form, sent: true }
  } catch (error) {
    return failForActionError(error, { form }, 500)
  }
}

// --- Verify email (resend form + link redemption) ---

export async function loadVerifyPage(request: Request, preloadData: PreloadDataAsync) {
  const copy = await loadEmailTokenCopy(request, preloadData, {
    "wiki-auth-verify-email": {},
    "wiki-auth-verify-email.intro": {},
    "wiki-auth-verify-email.email-sent": {},
    "wiki-auth-verify-email.resend-email": {},
    "email": {},
    "send": {}
  })
  const verifyForm = await superValidate(valibot(emailSchema))
  return { ...copy, verifyForm, sent: false }
}

export async function verifyIssueAction({ request, getClientAddress }: RequestEvent) {
  const ipAddress: string = resolveClientIp(request, getClientAddress())
  const form = await superValidate(request, valibot(emailSchema))

  if (!form.valid) {
    return fail(400, { form })
  }

  try {
    await emailVerifyIssue(
      { email: normalizeLookupEmail(form.data.email), ipAddress },
      {}
    )
    return { form, sent: true }
  } catch (error) {
    return failForActionError(error, { form }, 500)
  }
}

export async function loadVerifyTokenPage(
  request: Request,
  preloadData: PreloadDataAsync,
  token: string
) {
  const copy = await loadEmailTokenCopy(request, preloadData, {
    "wiki-auth-verify-email-link": {},
    "wiki-auth-verify-email-link.waiting": {},
    "wiki-auth-verify-email-link.please-interact": {},
    "wiki-auth-verify-email-link.instructions": {},
    "wiki-auth-verify-email-link.success": {}
  })
  const verifyTokenForm = await superValidate({ token }, valibot(tokenSchema))
  return { ...copy, verifyTokenForm, verified: false }
}

// Redemption happens on POST (the visitor's click/tap/keypress), never on
// page load: prefetchers and link scanners must not consume single-use
// links, and the bundle's verify-link copy promises exactly this gate.
export async function verifyRedeemAction({ request, getClientAddress }: RequestEvent) {
  const ipAddress: string = resolveClientIp(request, getClientAddress())
  const form = await superValidate(request, valibot(tokenSchema))

  if (!form.valid) {
    return fail(400, { form })
  }

  const malformed = failForMalformedToken(form.data.token, () => ({ form }))
  if (malformed) {
    return malformed
  }

  try {
    await emailVerifyRedeem({ token: form.data.token, ipAddress }, {})
    return { form, verified: true }
  } catch (error) {
    return failForActionError(error, { form }, 500)
  }
}

// --- Reset password (link redemption + new password) ---

export async function loadResetTokenPage(
  request: Request,
  preloadData: PreloadDataAsync,
  token: string
) {
  const copy = await loadEmailTokenCopy(request, preloadData, {
    "password-recovery": {},
    "reset-password": {},
    "login": {},
    "password": {},
    "confirm-password": {},
    "send": {}
  })
  const tokenForm = await superValidate({ token }, valibot(tokenSchema))
  const resetForm = await superValidate(valibot(newPasswordSchema))
  return { ...copy, tokenForm, resetForm, grant: null as string | null }
}

// Phase one exchanges the recovery link for a one-time password-set
// grant, again on POST only so mere delivery never spends the link. The
// grant, not the link, authorizes the new password.
export async function resetRedeemAction({ request, getClientAddress }: RequestEvent) {
  const ipAddress: string = resolveClientIp(request, getClientAddress())
  const form = await superValidate(request, valibot(tokenSchema))

  if (!form.valid) {
    return fail(400, { form })
  }

  const malformed = failForMalformedToken(form.data.token, () => ({ form }))
  if (malformed) {
    return malformed
  }

  try {
    const { grant } = await passwordResetRedeem({ token: form.data.token, ipAddress }, {})
    return { form, grant }
  } catch (error) {
    return failForActionError(error, { form }, 500)
  }
}

// Phase two sets the new password on grant authority alone and revokes
// every session of the account.
export async function resetCompleteAction({ request, getClientAddress }: RequestEvent) {
  const ipAddress: string = resolveClientIp(request, getClientAddress())
  const form = await superValidate(request, valibot(newPasswordSchema))
  const secrets = [form.data.password, form.data.confirmPassword]

  if (!form.valid) {
    return fail(
      400,
      redactAuthActionPayload({ form: clearRegisterPasswords(form) }, secrets)
    )
  }

  const malformed = failForMalformedToken(form.data.grant, () => ({
    form: clearRegisterPasswords(form)
  }))
  if (malformed) {
    return redactAuthActionPayload(malformed, secrets)
  }

  try {
    const { sessions_revoked } = await passwordResetComplete(
      {
        grant: form.data.grant,
        newPassword: form.data.password,
        ipAddress
      },
      {}
    )
    return redactAuthActionPayload(
      { form: clearRegisterPasswords(form), done: true, sessions_revoked },
      secrets
    )
  } catch (error) {
    return failForActionError(
      error,
      { form: clearRegisterPasswords(form) },
      500,
      (payload) => redactAuthActionPayload(payload, secrets)
    )
  }
}
