import type { TypographyRelationExpectations, TypographySnapshot } from "./wikidot-typography-parity-helpers"

export const HISTORIC_YOSSISTYLE_TYPOGRAPHY_DESKTOP: TypographySnapshot = {
  body: {
    fontFamily: "verdana, arial, helvetica, sans-serif",
    fontSize: "12.8px",
    fontWeight: "400",
    lineHeight: "normal",
    textRendering: "auto"
  },
  content: {
    fontFamily: "verdana, arial, helvetica, sans-serif",
    fontSize: "12.8px",
    fontWeight: "400",
    lineHeight: "19.2px",
    textRendering: "auto"
  },
  title: {
    fontFamily: "verdana, arial, helvetica, sans-serif",
    fontSize: "25.6px",
    fontWeight: "400",
    lineHeight: "normal",
    textRendering: "auto"
  }
}

export const YOSSISTYLE_RELATIONS: TypographyRelationExpectations = {
  titlePerBody: 2,
  contentPerBody: 1,
  leadingPerContent: 1.5
}
