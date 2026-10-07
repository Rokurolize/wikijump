// Keep JSON socket frames ASCII-only so UTF-8 code points cannot be split
// across Unix-socket data events before the server parses the frame.
export function stringifyAsciiJson(value) {
  return JSON.stringify(value).replace(/[^\x00-\x7f]/gu, character => {
    const codePoint = character.codePointAt(0);
    if (codePoint <= 0xffff) return `\\u${codePoint.toString(16).padStart(4, '0')}`;
    const value = codePoint - 0x10000;
    const high = 0xd800 + (value >> 10);
    const low = 0xdc00 + (value & 0x3ff);
    return `\\u${high.toString(16)}\\u${low.toString(16)}`;
  });
}
