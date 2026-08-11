import {
  loadUserSettings,
  userDisplaySettingsAction
} from "$lib/server/load/user-settings"

export async function load({ parent }) {
  return loadUserSettings(parent)
}

export const actions = {
  display: userDisplaySettingsAction
}
