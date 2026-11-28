<script lang="ts">
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands"
  import { bracketMatching, syntaxHighlighting } from "@codemirror/language"
  import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
  import { EditorState, Prec } from "@codemirror/state"
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
  import { diagnosticCount, setDiagnosticsEffect } from "@codemirror/lint"
  import { classHighlighter } from "@lezer/highlight"
  import WikitextEditorToolbar from "$lib/component/WikitextEditorToolbar.svelte"
  import { wikitextAssistExtensions } from "$lib/wikidot/wikitext-editor-assist"
  import {
    applyToolbarOperation,
    toolbarOperations,
    type ToolbarOperationId
  } from "$lib/wikidot/wikitext-editor-toolbar"
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
  let hintCount = $state(0)
  let view: EditorView | undefined
  let mirroredValue = value
  const synchronizeValue = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      mirroredValue = update.state.doc.toString()
      value = mirroredValue
    }
    if (
      update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(setDiagnosticsEffect))
      )
    ) {
      hintCount = diagnosticCount(update.state)
    }
  })

  const runToolbarOperation = (operation: ToolbarOperationId) => {
    if (!view) return
    const state = view.state
    const selection = state.selection.main
    const input = {
      text: state.doc.toString(),
      from: selection.from,
      to: selection.to
    }
    const options: { linkTarget?: string; imageSource?: string } = {}
    if (operation === "link") {
      // eslint-disable-next-line no-alert
      const target = globalThis.prompt("Link target")
      if (target === null) return
      options.linkTarget = target
    }
    if (operation === "image") {
      // eslint-disable-next-line no-alert
      const source = globalThis.prompt("Image source")
      if (source === null) return
      options.imageSource = source
    }
    const result = applyToolbarOperation(input, operation, options)
    if (!result) return
    view.dispatch({
      changes: { from: 0, to: state.doc.length, insert: result.text },
      selection: { anchor: result.from, head: result.to }
    })
    view.focus()
  }

  const toolbarKeymap = toolbarOperations.flatMap((operation) =>
    operation.shortcut
      ? [
          {
            key: operation.shortcut.key,
            run: () => {
              runToolbarOperation(operation.id)
              return true
            }
          }
        ]
      : []
  )

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
          wikitextAssistExtensions,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "role": "textbox",
            "aria-label": label,
            "aria-multiline": "true",
            "tabindex": "0"
          }),
          synchronizeValue,
          placeholder ? editorPlaceholder(placeholder) : [],
          Prec.high(keymap.of(toolbarKeymap)),
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

  const focusEnhancedEditor = () => {
    if (enhanced) view?.focus()
  }

  $effect(() => {
    if (!view || value === mirroredValue) return
    mirroredValue = value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value }
    })
  })
</script>

<div class="wikitext-editor" class:wikitext-editor-enhanced={enhanced}>
  {#if enhanced}
    <WikitextEditorToolbar onOperate={runToolbarOperation} />
  {/if}
  <textarea
    {id}
    {name}
    class="editor-wikitext wikitext-editor-fallback"
    aria-label={label}
    aria-hidden={enhanced ? "true" : undefined}
    tabindex={enhanced ? -1 : undefined}
    {placeholder}
    onfocus={focusEnhancedEditor}
    bind:value></textarea>
  <div class="wikitext-editor-cm" bind:this={host}></div>
  {#if enhanced && hintCount > 0}
    <p class="wikitext-editor-hint-notice" role="status">
      {hintCount} editor heuristic warning{hintCount === 1 ? "" : "s"} — not render errors.
    </p>
  {/if}
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
    position: absolute;
    width: 0;
    height: 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    opacity: 0;
  }

  .wikitext-editor-toolbar {
    box-sizing: border-box;
    width: 100%;
    max-width: 100%;
    padding: 0.25rem;
    margin: 0 0 0.25rem;
    background: var(--col-background, rgb(246, 246, 246));
    border: 1px solid var(--col-border, rgb(180, 180, 180));
  }

  .wikitext-editor-toolbar-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    max-width: 100%;
  }

  .wikitext-editor-toolbar button {
    min-width: 1.9rem;
    min-height: 1.8rem;
    padding: 0.15rem 0.35rem;
    font: inherit;
    font-size: 0.86em;
    color: var(--col-text, rgb(20, 20, 20));
    cursor: pointer;
    background: var(--col-background-dim, rgb(255, 255, 255));
    border: 1px solid var(--col-border, rgb(150, 150, 150));
    border-radius: 2px;
  }

  .wikitext-editor-toolbar button:hover {
    background: var(--col-background-hover, rgb(235, 240, 245));
  }

  .wikitext-editor-toolbar button:focus-visible {
    outline: 2px solid var(--col-hint, rgb(50, 100, 180));
    outline-offset: 1px;
  }

  .wikitext-editor-toolbar-note {
    margin: 0.25rem 0 0;
    font-size: 0.82em;
    line-height: 1.35;
    color: var(--col-text-dim, rgb(80, 80, 80));
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

  .wikitext-editor .cm-wikitext-heuristic {
    text-decoration: underline dotted rgb(190, 130, 20);
    text-decoration-thickness: 2px;
    background: rgb(255, 220, 120, 0.22);
  }

  .wikitext-editor .cm-tooltip {
    max-width: min(28rem, 90vw);
    color: var(--col-text, rgb(20, 20, 20));
    background: var(--col-background-dim, rgb(255, 255, 255));
    border: 1px solid var(--col-border, rgb(150, 150, 150));
    border-radius: 2px;
    box-shadow: 0 2px 8px rgb(0, 0, 0, 0.18);
  }

  .wikitext-editor .cm-tooltip-autocomplete ul li[aria-selected] {
    color: var(--col-background-dim, rgb(255, 255, 255));
    background: rgb(50, 100, 180);
  }

  .wikitext-assist-hover {
    padding: 0.45rem 0.6rem;
    font-size: 0.88em;
    line-height: 1.4;
  }

  .wikitext-assist-hover-title {
    font-weight: 700;
  }

  .wikitext-assist-hover-detail {
    color: var(--col-text-dim, rgb(80, 80, 80));
  }

  .wikitext-editor-hint-notice {
    margin: 0.25rem 0 0;
    font-size: 0.82em;
    color: rgb(120, 78, 10);
  }

  @media (width <= 480px) {
    .wikitext-editor .cm-editor {
      height: 52vh;
      min-height: 12rem;
    }
  }
</style>
