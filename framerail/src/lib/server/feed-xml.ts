const SPACE = 0x20
const TAB = 0x09
const LINE_FEED = 0x0a
const CARRIAGE_RETURN = 0x0d

function isXmlValidCodePoint(codePoint: number): boolean {
  return (
    codePoint >= SPACE ||
    codePoint === TAB ||
    codePoint === LINE_FEED ||
    codePoint === CARRIAGE_RETURN
  )
}

export function hasInvalidXmlC0(value: string): boolean {
  return Array.from(value).some(
    (character) => !isXmlValidCodePoint(character.codePointAt(0) ?? -1)
  )
}

function stripInvalidXmlC0(value: string): string {
  let stripped = ""
  for (const character of value) {
    if (isXmlValidCodePoint(character.codePointAt(0) ?? -1)) stripped += character
  }
  return stripped
}

export function escapeFeedXmlCdata(value: string): string {
  return stripInvalidXmlC0(value).replaceAll("]]>", "]]]]><![CDATA[>")
}

export function escapeFeedXmlText(value: string): string {
  let escaped = ""
  for (const character of stripInvalidXmlC0(value)) {
    switch (character) {
      case "&":
        escaped += "&amp;"
        break
      case "<":
        escaped += "&lt;"
        break
      case ">":
        escaped += "&gt;"
        break
      case '"':
        escaped += "&quot;"
        break
      case "'":
        escaped += "&#039;"
        break
      default:
        escaped += character
    }
  }
  return escaped
}
