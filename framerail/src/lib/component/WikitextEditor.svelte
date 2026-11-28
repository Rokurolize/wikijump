<script lang="ts">
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
  import { bracketMatching, syntaxHighlighting } from "@codemirror/language"
  import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
  import { EditorState } from "@codemirror/state"
  import {
    crosshairCursor,
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    placeholder as editorPlaceholder,
    rectangularSelection
  } from "@codemirror/view"
  import { classHighlighter } from "@lezer/highlight"
  import { wikitextEditorLanguage } from "$lib/wikidot/wikitext-editor-language"
  import { onMount } from "svelte"

  let {
    value = $bindable(""),
    name = "wikitext",
    label = "Page source",
    placeholder = "",
    id = "wikitext-editor"
  }: {
    value?: string
    name?: string
    label?: string
    placeholder?: string
    id?: string
  } = $props()

  let host: HTMLDivElement
  let enhanced = $state(false)
  let view: EditorView | undefined
  let mirroredValue = value
  const synchronizeValue = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return
    mirroredValue = update.state.doc.toString()
    value = mirroredValue
  })

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          bracketMatching(),
          highlightSelectionMatches(),
          wikitextEditorLanguage.extension,
          syntaxHighlighting(classHighlighter),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "role": "textbox",
            "aria-label": label,
            "aria-multiline": "true",
            "tabindex": "0"
          }),
          synchronizeValue,
          placeholder ? editorPlaceholder(placeholder) : [],
          keymap.of([...historyKeymap, ...searchKeymap, ...defaultKeymap])
        ]
      })
    })
    enhanced = true
    return () => {
      view?.destroy()
      view = undefined
    }
  })

  $effect(() => {
    if (!view || value === mirroredValue) return
    mirroredValue = value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    })
  })
</script>

<div class="wikitext-editor" class:wikitext-editor-enhanced={enhanced}>
  <textarea
    {id}
    {name}
    class="editor-wikitext wikitext-editor-fallback"
    aria-label={label}
    aria-hidden={enhanced ? "true" : undefined}
    tabindex={enhanced ? -1 : undefined}
    {placeholder}
    bind:value></textarea>
  <div class="wikitext-editor-cm" bind:this={host}></div>
</div>

<style global lang="scss">
  .wikitext-editor {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    max-width: 100%;
  }

  .wikitext-editor-fallback {
    width: 100%;
    height: 60vh;
    font-family: var(--font-mono, monospace);
  }

  .wikitext-editor-enhanced .wikitext-editor-fallback {
    display: none;
  }

  .wikitext-editor-cm {
    width: 100%;
    max-width: 100%;
  }

  .wikitext-editor .cm-editor {
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    height: 60vh;
    min-height: 14rem;
    color: var(--col-text, rgb(20, 20, 20));
    background: var(--col-background-dim, rgb(255, 255, 255));
    border: 1px solid var(--col-border, rgb(119, 119, 119));
  }

  .wikitext-editor .cm-editor.cm-focused {
    outline: 2px solid var(--col-hint, rgb(50, 100, 180));
    outline-offset: 1px;
    border-color: var(--col-hint, rgb(50, 100, 180));
  }

  .wikitext-editor .cm-scroller {
    overflow: auto;
    overscroll-behavior: auto;
    font-family: var(--font-mono, monospace);
    line-height: 1.45;
    touch-action: pan-x pan-y;
  }

  .wikitext-editor .cm-content {
    box-sizing: border-box;
    min-width: 0;
    padding: 0.45em 0;
  }

  .wikitext-editor .cm-line {
    padding: 0 0.55em;
    overflow-wrap: anywhere;
  }

  .wikitext-editor .cm-gutters {
    color: var(--col-text-dim, rgb(105, 105, 105));
    background: var(--col-background, rgb(246, 246, 246));
    border-right: 1px solid var(--col-border, rgb(221, 221, 221));
  }

  .wikitext-editor .cm-activeLine {
    background: rgb(80, 130, 190, 0.1);
  }

  .wikitext-editor .cm-activeLineGutter {
    background: rgb(80, 130, 190, 0.16);
  }

  .wikitext-editor .cm-selectionMatch,
  .wikitext-editor .cm-searchMatch {
    background: rgb(255, 210, 80, 0.35);
  }

  .wikitext-editor .tok-heading {
    font-weight: 700;
    color: rgb(166, 67, 93);
  }

  .wikitext-editor .tok-link {
    color: rgb(42, 124, 202);
    text-decoration: underline;
  }

  .wikitext-editor .tok-keyword {
    font-weight: 600;
    color: rgb(139, 83, 180);
  }

  .wikitext-editor .tok-comment {
    color: rgb(93, 132, 72);
  }

  .wikitext-editor .tok-strong {
    font-weight: 700;
  }

  .wikitext-editor .tok-emphasis {
    font-style: italic;
  }

  .wikitext-editor .tok-meta {
    color: rgb(0, 132, 143);
  }

  @media (width <= 480px) {
    .wikitext-editor .cm-editor {
      height: 52vh;
      min-height: 12rem;
    }
  }
</style>
