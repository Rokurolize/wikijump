import { client } from "$lib/server/deepwell"

import type { RequestContext } from "$lib/server/request-context"

export interface EmailTokenIssueInput {
  email: string
  ipAddress: string
}

export interface EmailTokenRedeemInput {
  token: string
  ipAddress: string
}

export interface ResetGrantOutput {
  grant: string
}

export interface ResetCompleteInput {
  grant: string
  newPassword: string
  ipAddress: string
}

export interface ResetCompleteOutput {
  sessions_revoked: number
}

/** Request a verification link. Anonymous-safe: always 200, no oracle. */
export async function emailVerifyIssue(
  input: EmailTokenIssueInput,
  context: RequestContext = {}
): Promise<void> {
  return client.request(
    "email_verify_issue",
    {
      email: input.email,
      ip_address: input.ipAddress
    },
    context
  )
}

/** Redeem a verification link. The token, not a session, is the authority. */
export async function emailVerifyRedeem(
  input: EmailTokenRedeemInput,
  context: RequestContext = {}
): Promise<void> {
  return client.request(
    "email_verify_redeem",
    {
      token: input.token,
      ip_address: input.ipAddress
    },
    context
  )
}

/** Request a password-recovery link. Anonymous-safe: always 200, no oracle. */
export async function passwordResetIssue(
  input: EmailTokenIssueInput,
  context: RequestContext = {}
): Promise<void> {
  return client.request(
    "password_reset_issue",
    {
      email: input.email,
      ip_address: input.ipAddress
    },
    context
  )
}

/** Exchange a recovery link for a one-time password-set grant. */
export async function passwordResetRedeem(
  input: EmailTokenRedeemInput,
  context: RequestContext = {}
): Promise<ResetGrantOutput> {
  return client.request(
    "password_reset_redeem",
    {
      token: input.token,
      ip_address: input.ipAddress
    },
    context
  )
}

/** Set a new password on grant authority alone; revokes all sessions. */
export async function passwordResetComplete(
  input: ResetCompleteInput,
  context: RequestContext = {}
): Promise<ResetCompleteOutput> {
  return client.request(
    "password_reset_complete",
    {
      grant: input.grant,
      new_password: input.newPassword,
      ip_address: input.ipAddress
    },
    context
  )
}

export interface AccountDeleteIssueInput {
  ipAddress: string
}

export interface AccountDeleteRedeemInput {
  token: string
  ipAddress: string
}

export interface DeleteGrantOutput {
  grant: string
}

export interface AccountDeleteCompleteInput {
  grant: string
  password: string
  ipAddress: string
}

export interface DeleteCompleteOutput {
  sessions_revoked: number
}

/** Request an account-deletion confirmation link for the signed-in account. */
export async function accountDeleteIssue(
  input: AccountDeleteIssueInput,
  context: RequestContext = {}
): Promise<void> {
  return client.request(
    "account_delete_issue",
    {
      ip_address: input.ipAddress
    },
    context
  )
}

/** Exchange an account-deletion link for a one-time deletion grant. */
export async function accountDeleteRedeem(
  input: AccountDeleteRedeemInput,
  context: RequestContext = {}
): Promise<DeleteGrantOutput> {
  return client.request(
    "account_delete_redeem",
    {
      token: input.token,
      ip_address: input.ipAddress
    },
    context
  )
}

/** Delete the signed-in account on grant + password authority. */
export async function accountDeleteComplete(
  input: AccountDeleteCompleteInput,
  context: RequestContext = {}
): Promise<DeleteCompleteOutput> {
  return client.request(
    "account_delete_complete",
    {
      grant: input.grant,
      password: input.password,
      ip_address: input.ipAddress
    },
    context
  )
}
