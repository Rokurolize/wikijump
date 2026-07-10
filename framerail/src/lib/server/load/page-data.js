/**
 * Remove server-only viewer details before article route data is
 * serialized.
 *
 * @param {Record<string, unknown>} parentData
 * @returns {Record<string, unknown>}
 */
const sanitizeParentData = (parentData) => {
  const userSession = parentData.user_session

  if (
    userSession === null ||
    typeof userSession !== "object" ||
    Array.isArray(userSession)
  ) {
    return parentData
  }

  const safeUserSession = { ...userSession }
  delete safeUserSession.session

  return {
    ...parentData,
    user_session: safeUserSession
  }
}

/**
 * @param {Record<string, unknown>} parentData
 * @param {Record<string, unknown>} viewData
 * @param {unknown} forms
 * @returns {Record<string, unknown>}
 */
export const buildPageLoadData = (parentData, viewData, forms) => {
  return {
    ...sanitizeParentData(parentData),
    ...viewData,
    forms
  }
}
