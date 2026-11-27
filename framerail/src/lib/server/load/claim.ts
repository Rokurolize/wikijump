import defaults from "$lib/defaults"
import {
  ACCOUNT_PASSWORD_TOO_SHORT,
  accountPasswordMeetsMinimum
} from "$lib/account-password-policy.js"

import { isUserExistsError } from "$lib/server/deepwell/public-error"
import { translate } from "$lib/server/deepwell/translate"
import {
  userSelfActivateFromWikidot,
  wikidotClaimChallengeStart,
  wikidotClaimChallengeVerify
} from "$lib/server/deepwell/user"
import {
  clearRegisterPasswords,
  redactAuthActionPayload
} from "$lib/server/load/auth-form-redaction"
import { failForActionError, normalizeActionError } from "$lib/server/load/action-error"
import { isRegistrationHoneypotTripped } from "$lib/server/load/register-honeypot"
import { loadSiteInfo } from "$lib/server/load/site-info"
import { fail } from "@sveltejs/kit"
import { superValidate } from "sveltekit-superforms"
import { valibot } from "sveltekit-superforms/adapters"
import {
  array,
  check,
  email,
  forward,
  minLength,
  object,
  optional,
  partialCheck,
  pipe,
  string
} from "valibot"

import type { PreloadDataAsync } from "$lib/server/deepwell/views"
import type { TranslateKeys } from "$lib/types"
import type { RequestEvent } from "@sveltejs/kit"
import {
  areSupportedUserInterfaceLocales,
  USER_INTERFACE_LOCALES
} from "$lib/user-interface-locales"

export async function loadClaimPage(
  request: Request,
  preloadData: PreloadDataAsync,
  url: URL
) {
  loadSiteInfo(request.headers)

  const parentData = await preloadData()
  const locales = parentData.locales
  const isLoggedIn = Boolean(parentData.user_session)

  const translateKeys: TranslateKeys = {
    ...defaults.translateKeys,

    "cancel": {},
    "email": {},
    "email.placeholder": {},
    "email.info": {},
    "password": {},
    "password.placeholder": {},
    "confirm-password": {},
    "login": {},

    "error-form.password-mismatch": {},
    "error-form.password-too-short": {},
    "error-form.email-invalid": {},

    "dashboard-account.language": {}
  }

  const internationalization = await translate(locales, translateKeys)
  const initialToken = url.searchParams.get("token")?.trim() ?? ""
  const claimForm = await superValidate(
    { claimToken: initialToken, locale: ["en"] },
    valibot(claimSchema),
    { errors: false }
  )

  return {
    isLoggedIn,
    internationalization,
    claimForm,
    userInterfaceLocales: USER_INTERFACE_LOCALES
  }
}

export async function claimAction({ request, getClientAddress }: RequestEvent) {
  const form = await superValidate(request, valibot(claimSchema))
  const submittedPasswords = [form.data.password, form.data.confirmPassword]

  if (!form.valid) {
    return fail(
      400,
      redactAuthActionPayload({ form: clearRegisterPasswords(form) }, submittedPasswords)
    )
  }

  if (isRegistrationHoneypotTripped(form.data.leaveBlank)) {
    return fail(
      400,
      redactAuthActionPayload({ form: clearRegisterPasswords(form) }, submittedPasswords)
    )
  }

  const ipAddress = getClientAddress()
  const { data } = form

  try {
    const user = await userSelfActivateFromWikidot({
      claimToken: data.claimToken.trim(),
      email: data.email,
      locales: data.locale,
      password: data.password,
      ipAddress
    })

    return redactAuthActionPayload(
      {
        form: clearRegisterPasswords(form),
        activatedSlug: user.slug,
        isClaimed: true
      },
      submittedPasswords
    )
  } catch (error) {
    if (isUserExistsError(error)) {
      return fail(
        400,
        redactAuthActionPayload(
          { form: clearRegisterPasswords(form), ...normalizeActionError(error) },
          submittedPasswords
        )
      )
    }

    return failForActionError(
      error,
      { form: clearRegisterPasswords(form) },
      500,
      (payload) => redactAuthActionPayload(payload, submittedPasswords)
    )
  }
}

export async function startProfileChallengeAction({
  request,
  getClientAddress
}: RequestEvent) {
  const formData = await request.formData()
  const rawId = String(formData.get("wikidotUserId") ?? "").trim()
  const wikidotUserId = Number(rawId)
  if (!Number.isInteger(wikidotUserId) || wikidotUserId <= 0) {
    return fail(400, { challengeError: "Enter a valid positive Wikidot user ID." })
  }

  try {
    const issued = await wikidotClaimChallengeStart(wikidotUserId, getClientAddress())
    return {
      challengeToken: issued.token,
      challengeNonce: issued.challenge_nonce,
      challengeWikidotUserId: issued.wikidot_user_id
    }
  } catch (error) {
    return failForActionError(error, {}, 500)
  }
}

export async function verifyProfileChallengeAction({
  request,
  getClientAddress
}: RequestEvent) {
  const formData = await request.formData()
  const token = String(formData.get("challengeToken") ?? "").trim()
  if (!token) {
    return fail(400, { challengeError: "Missing challenge token." })
  }

  try {
    await wikidotClaimChallengeVerify(token, getClientAddress())
    return {
      verifiedToken: token,
      challengeVerified: true
    }
  } catch (error) {
    return failForActionError(error, {}, 500)
  }
}

const claimSchema = pipe(
  object({
    claimToken: pipe(string(), minLength(1)),
    email: pipe(string(), email(), minLength(1)),
    password: pipe(
      string(),
      check(accountPasswordMeetsMinimum, ACCOUNT_PASSWORD_TOO_SHORT)
    ),
    confirmPassword: pipe(string(), minLength(1)),
    leaveBlank: optional(string()),
    locale: pipe(
      optional(array(string()), ["en"]),
      minLength(1),
      check(areSupportedUserInterfaceLocales, "Choose a supported display language.")
    )
  }),
  forward(
    partialCheck(
      [["password"], ["confirmPassword"]],
      ({ password, confirmPassword }) => password === confirmPassword
    ),
    ["confirmPassword"]
  )
)
