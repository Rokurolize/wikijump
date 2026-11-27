import { client, type RegistrationMode } from "./index"
import type { RequestContext } from "../request-context"

export interface PlatformSettingsSnapshot {
  allow_registration_config: boolean
  allow_registration_override: boolean | null
  effective_allow_registration: boolean
  registration_mode: RegistrationMode
  active_passcode_count: number
}

export interface RegistrationPasscodeSummary {
  passcode_id: number
  label: string | null
  issuer_user_id: number
  created_at: string
  expires_at: string
  max_uses: number | null
  use_count: number
  revoked_at: string | null
  revoked_by: number | null
  is_active: boolean
}

export interface PlatformSettingsGetOutput {
  settings: PlatformSettingsSnapshot
  passcodes: RegistrationPasscodeSummary[]
}

export interface IssuedRegistrationPasscode {
  passcode_id: number
  passcode: string
  label: string | null
  created_at: string
  expires_at: string
  max_uses: number | null
}

export async function platformSettingsGet(
  requestContext: RequestContext
): Promise<PlatformSettingsGetOutput> {
  return client.request("platform_settings_get", {}, requestContext)
}

export async function platformSettingUpdate(
  allowRegistration: boolean | null,
  ipAddress: string,
  requestContext: RequestContext
): Promise<PlatformSettingsSnapshot> {
  return client.request(
    "platform_setting_update",
    {
      allow_registration: allowRegistration,
      ip_address: ipAddress
    },
    requestContext
  )
}

export async function registrationPasscodeIssue(
  {
    label,
    expiresInSeconds,
    maxUses,
    passcode,
    ipAddress
  }: {
    label?: string
    expiresInSeconds?: number
    maxUses?: number | null
    passcode?: string
    ipAddress: string
  },
  requestContext: RequestContext
): Promise<IssuedRegistrationPasscode> {
  return client.request(
    "registration_passcode_issue",
    {
      label: label || null,
      expires_in_seconds: expiresInSeconds ?? null,
      max_uses: maxUses ?? null,
      passcode: passcode || null,
      ip_address: ipAddress
    },
    requestContext
  )
}

export async function registrationPasscodeRevoke(
  passcodeId: number,
  ipAddress: string,
  requestContext: RequestContext
): Promise<void> {
  await client.request(
    "registration_passcode_revoke",
    {
      passcode_id: passcodeId,
      ip_address: ipAddress
    },
    requestContext
  )
}
