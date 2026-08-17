<script lang="ts">
  import { wikidotCollapsibles } from "$lib/wikidot/wikidot-collapsibles"

  import type { HTMLAnchorAttributes } from "svelte/elements"

  const pageTopAnchorAttributes: HTMLAnchorAttributes & { name: string } = {
    name: "page-top"
  }

  let { header, topBar, loginStatus, sideBar, content, footer, license } = $props()
</script>

<div id="skrollr-body" data-sveltekit-reload use:wikidotCollapsibles>
  <a {...pageTopAnchorAttributes}></a>
  <div id="container-wrap-wrap">
    <div id="container-wrap">
      <div id="container">
        <div id="header">
          {@render header?.()}
          <div id="top-bar">
            {@render topBar?.()}
          </div>
          {@render loginStatus?.()}
          <div id="header-extra-div-1"><span></span></div>
          <div id="header-extra-div-2"><span></span></div>
          <div id="header-extra-div-3"><span></span></div>
        </div>
        <div id="content-wrap">
          <div id="side-bar">
            {@render sideBar?.()}
          </div>
          <div id="main-content">
            <div id="action-area-top"></div>
            {@render content?.()}
          </div>
        </div>
        <div id="footer">
          {@render footer?.()}
        </div>
        <div id="license-area" class="license-area">
          {@render license?.()}
        </div>
        <div id="extrac-div-1"><span></span></div>
        <div id="extrac-div-2"><span></span></div>
        <div id="extrac-div-3"><span></span></div>
      </div>
      <div id="extra-div-1"><span></span></div>
      <div id="extra-div-2"><span></span></div>
      <div id="extra-div-3"><span></span></div>
      <div id="extra-div-4"><span></span></div>
      <div id="extra-div-5"><span></span></div>
      <div id="extra-div-6"><span></span></div>
    </div>
  </div>
</div>

<!-- Ignoring the styling as being a theme it will inevitably style other elements in the entire layout -->
<!-- svelte-ignore css_unused_selector -->
<style global lang="scss">
  $tablet-max-width: 767px;

  :root {
    /* Fallback colors */
    --text: #111;
    --background: #fff;
    --border: #0006;
    --mild-text: #f0f0f0;
    --accent: #0066cc;
    --error: #b42d0a;
    --col-accent-1: #19a9ff;
    --col-accent-2: #0068b5;
  }

  .clickable {
    cursor: pointer;
    user-select: none;

    &:disabled {
      cursor: auto;
    }
  }

  .hidden {
    display: none;
  }

  // Wikidot hides legacy equations until its MathJax loader completes. The
  // local imported shell does not run that remote loader, so keep the exact
  // server-rendered equation body visible instead of losing it to the base
  // stylesheet's display rule.
  #page-content .math-equation {
    display: block;
  }

  // Wikidot's base stylesheet expects legacy JavaScript to open this menu.
  // Imported themes such as Basalt already implement the hover/focus state in
  // CSS; this fallback keeps the same account menu usable on ordinary themes.
  #login-status:hover > #account-options,
  #login-status:focus-within > #account-options {
    display: block;
  }

  details.collapsible-block:not([open]) .collapsible-block-unfolded-link {
    display: none;
  }

  details.collapsible-block[open]
    > summary
    .collapsible-block-link:not(.collapsible-block-unfolded-link) {
    display: none;
  }

  @media (prefers-color-scheme: light) {
    :root {
      /* Fallback colors */
      --text: #111;
      --background: #fff;
      --border: #0006;
      --mild-text: #f0f0f0;
      --accent: #0066cc;
    }
  }

  @media (prefers-color-scheme: dark) {
    :root {
      /* Fallback colors */
      --text: #b6c2cf;
      --background: #222;
      --border: #b6c2cf;
      --mild-text: #bbb;
      --accent: #44aaff;
    }
  }

  @media (max-width: $tablet-max-width) {
    .header {
      height: initial;
    }
  }
</style>
