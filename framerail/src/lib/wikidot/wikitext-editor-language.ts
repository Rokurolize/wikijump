import { StreamLanguage } from "@codemirror/language"

import type { StringStream } from "@codemirror/streamparser"

type WikitextEditorLexerState = {
  inComment: boolean
}

const consumeComment = (stream: StringStream, state: WikitextEditorLexerState) => {
  while (!stream.eol()) {
    if (stream.match("--]")) {
      state.inComment = false
      break
    }
    stream.next()
  }
  return "comment"
}

const consumeDelimited = (stream: StringStream, delimiter: string) => {
  if (stream.string.indexOf(delimiter, stream.pos + delimiter.length) === -1) {
    return false
  }
  for (let index = 0; index < delimiter.length; index += 1) stream.next()
  while (!stream.eol()) {
    if (stream.match(delimiter)) return true
    stream.next()
  }
  return true
}

const consumeBracketed = (stream: StringStream, terminator: string) => {
  while (!stream.eol()) {
    if (stream.match(terminator)) return
    stream.next()
  }
}

// Presentation-only editor lexer; FTML and Deepwell remain the parser truth.
export const wikitextEditorLanguage = StreamLanguage.define<WikitextEditorLexerState>({
  name: "wikitext-editor-presentation",
  startState: () => ({ inComment: false }),
  copyState: (state) => ({ ...state }),
  token(stream, state) {
    if (state.inComment) return consumeComment(stream, state)

    if (stream.sol() && stream.match(/^\+{1,6}(?=\s)/u)) {
      stream.skipToEnd()
      return "heading"
    }

    if (stream.match("[!--")) {
      state.inComment = true
      return consumeComment(stream, state)
    }

    if (stream.match("[[[")) {
      consumeBracketed(stream, "]]]")
      return "link"
    }

    if (stream.match(/^\[(?:https?:\/\/|mailto:)[^\]\n]*\]/u)) return "link"

    if (stream.match("[[")) {
      consumeBracketed(stream, "]]")
      return "keyword"
    }

    if (stream.match(/^%%[A-Za-z0-9_-]+(?:\|[^\n%]*)?%%/u)) return "meta"
    if (stream.match(/^\{\$[A-Za-z0-9_-]+\}/u)) return "meta"

    if (stream.string.startsWith("**", stream.pos) && consumeDelimited(stream, "**")) {
      return "strong"
    }

    if (
      stream.string.startsWith("//", stream.pos) &&
      stream.string[stream.pos - 1] !== ":" &&
      consumeDelimited(stream, "//")
    ) {
      return "emphasis"
    }

    if (stream.eatSpace()) return null
    stream.next()
    return null
  }
})
