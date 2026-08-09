import {
  adminAction,
  analyticsAction,
  autonumberAction,
  discussionAction,
  forumNestingAction,
  siteIconsAction,
  licenseAction,
  layoutAction,
  loadAdminPage,
  navigationAction,
  ratingAction,
  themeAction,
  toolbarAction,
  templateAction
} from "$lib/server/load/admin"

export async function load({ request, cookies, parent }) {
  return loadAdminPage(request, cookies, parent)
}

export const actions = {
  site: adminAction,
  analytics: analyticsAction,
  autonumber: autonumberAction,
  discussion: discussionAction,
  forumNesting: forumNestingAction,
  siteIcons: siteIconsAction,
  navigation: navigationAction,
  license: licenseAction,
  rating: ratingAction,
  siteLayout: layoutAction,
  theme: themeAction,
  toolbar: toolbarAction,
  template: templateAction
}
