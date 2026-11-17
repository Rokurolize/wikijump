export interface AuditedExternalAssetOrigin {
  origin: string
  styles: boolean
  fonts: boolean
  evidence: string
}

export const AUDITED_EXTERNAL_ASSET_ORIGINS: readonly AuditedExternalAssetOrigin[] =
  Object.freeze([
    {
      origin: "https://*.wdfiles.com",
      styles: true,
      fonts: true,
      evidence:
        "Wikidot's own file host. Serves imported `local--files` stylesheet and font attachments, e.g. `component:theme`'s `font-bauhaus.css` in the retained shared-corpus copies of `component:classified-decoration-base`."
    },
    {
      origin: "https://cdn.scpwiki.com",
      styles: true,
      fonts: true,
      evidence:
        "SCP Wiki CDN, cited by the retained Theme Lab port manifests (e.g. `install/local/theme-lab/ports/basalt/manifest.json`)."
    },
    {
      origin: "https://cdn.jsdelivr.net",
      styles: true,
      fonts: true,
      evidence:
        "jsDelivr CDN, cited by the retained Theme Lab port manifests (e.g. `install/local/theme-lab/ports/cosmonaut/manifest.json`)."
    },
    {
      origin: "https://fastly.jsdelivr.net",
      styles: true,
      fonts: true,
      evidence:
        "jsDelivr's Fastly edge host. The production SCP-KO dear-dictator theme declares its noonfonts faces (GapyeongHanseokbong-Bold, ONE-Mobile-Title, JeonjuCraftGoR) with @font-face sources on this host; live Wikidot loads them, but framerail's page Content-Security-Policy blocked all three during the 2026-11-13 Sigma-10 migration comparison, so the theme fell back to substitute fonts on the staff-lab Sigma-10 site. Stylesheets are served from this host too: theme:the-track-changers and its JP port @import the crimson-anemone Basalt variant's basalt.css and components/collapsible-sidebar.css (@main) from it, and theme:dream-of-the-stars-jp (@2.3.16), theme:paradigm-inapplicable-jp (@2.4.4) and theme:paradigm-reconstruction-jp (@2.3.16) @import its dustjacket.css; the browser recorded failed style-src fetches for the track-changers pair on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep, leaving the page on the default background while live Wikidot loads them."
    },
    {
      origin: "https://d3g0gp89917ko0.cloudfront.net",
      styles: true,
      fonts: true,
      evidence:
        "Legacy SCP Wiki CloudFront distribution, cited by the retained Theme Lab port manifests (e.g. `install/local/theme-lab/ports/site/manifest.json`)."
    },
    {
      origin: "https://fonts.bunny.net",
      styles: true,
      fonts: true,
      evidence:
        "Bunny Fonts, cited by the retained Theme Lab port manifests (e.g. `install/local/theme-lab/ports/al-slop/manifest.json`)."
    },
    {
      origin: "https://fonts.googleapis.com",
      styles: true,
      fonts: false,
      evidence:
        "Google Fonts stylesheet host. Still loading with HTTP 200 on both origins for `component:classified-decoration-base`'s `Noto Serif KR` import (the #2213 control), and cited by the Theme Lab port manifests (e.g. `install/local/theme-lab/ports/foxtrot/manifest.json`)."
    },
    {
      origin: "https://fonts.gstatic.com",
      styles: false,
      fonts: true,
      evidence:
        "Google Fonts font-file host for the stylesheets that Google Fonts serves."
    },
    {
      origin: "https://api.fonts.coollabs.io",
      styles: true,
      fonts: false,
      evidence:
        "Cool Labs Fonts stylesheet API (a Google Fonts-compatible css2 endpoint). The production SCP-JP cosmonaut theme @imports its Berkshire Swash, Atkinson Hyperlegible and Anonymous Pro stylesheets from this origin; measured loading with HTTP 200 on live Wikidot and blocked by style-src on the staff-lab Sigma-10 site during the 2026-11-13 Sigma-10 migration comparison."
    },
    {
      origin: "https://cdn.fonts.coollabs.io",
      styles: false,
      fonts: true,
      evidence:
        "Cool Labs Fonts font-file host for the stylesheets that api.fonts.coollabs.io serves (the same stylesheet/file split as fonts.googleapis.com and fonts.gstatic.com)."
    },
    {
      origin: "https://fontlibrary.org",
      styles: true,
      fonts: true,
      evidence:
        "Font Library, an open font CDN. The simple-yonder theme @imports its Glacial Indifference face stylesheet from this origin; measured blocked by style-src on the staff-lab Sigma-10 site during the 2026-11-13 Sigma-10 migration comparison, while live Wikidot loads it."
    },
    {
      origin: "https://maxcdn.bootstrapcdn.com",
      styles: true,
      fonts: true,
      evidence:
        "Legacy Bootstrap CDN, cited by the retained Theme Lab port manifests (e.g. `install/local/theme-lab/ports/site/manifest.json`)."
    },
    {
      origin: "https://use.typekit.net",
      styles: true,
      fonts: true,
      evidence:
        "Adobe Fonts (Typekit) kit stylesheets and font files, cited by the retained Theme Lab port manifests (`install/local/theme-lab/ports/aesthetic-theme/manifest.json`, `install/local/theme-lab/ports/ouroborous-theme/manifest.json`) and observed loading on live Wikidot in `install/local/wikidot-verification/artifacts/theme-sweep-external-origins-20261019.json`."
    },
    {
      origin: "https://p.typekit.net",
      styles: true,
      fonts: false,
      evidence:
        "Typekit's kit stylesheets begin with `@import url(https://p.typekit.net/p.css?...)`, a near-empty stylesheet, so a kit that is allowed must be able to complete that import (retained observation in `install/local/wikidot-verification/artifacts/theme-sweep-external-origins-20261019.json`)."
    },
    {
      origin: "https://nu-scptheme.github.io",
      styles: true,
      fonts: true,
      evidence:
        "Nu SCP Theme GitHub Pages host for the Black Highlighter component, cited by the retained Theme Lab port manifests (e.g. `install/local/theme-lab/ports/hansarp/manifest.json`)."
    },
    {
      origin: "https://rsms.me",
      styles: true,
      fonts: true,
      evidence:
        "Rasmus Andersson's font host (Inter), cited by the retained Theme Lab port manifests (e.g. `install/local/theme-lab/ports/foxtrot/manifest.json`)."
    },
    {
      origin: "https://scp-wiki-cdn.nyc3.cdn.digitaloceanspaces.com",
      styles: true,
      fonts: true,
      evidence:
        "SCP Wiki DigitalOcean Spaces CDN, cited by the retained Theme Lab port assets (e.g. `install/local/theme-lab/ports/basalt/assets.json`)."
    },
    {
      origin: "https://scp-jp.github.io",
      styles: true,
      fonts: true,
      evidence:
        "SCP-JP community GitHub Pages host. Serves the production scp-jp theme stylesheet (sigma-9.min.css), the JP credit-module stylesheet that imported scp-jp articles @import, and the Bauhaus font CSS recorded as a dependency of the frozen Sigma-9 baseline (install/local/theme-lab/fixtures/scp-jp-sigma9-offline.json); retained sweep in install/local/wikidot-verification/artifacts/scp-jp-external-origins-20261025.json (issue #2759)."
    },
    {
      origin: "https://cdnjs.cloudflare.com",
      styles: true,
      fonts: true,
      evidence:
        "cdnjs CDN. Imported Wikidot credit modules reference the cc-icons stylesheet (https://cdnjs.cloudflare.com/ajax/libs/cc-icons/1.2.1/css/cc-icons.min.css, 4,231 bytes, sha256 cea128bf70e5dcd2d9c9d3ded35080f775cf564ea59d1a0380375f4748526722), whose @font-face loads the icon fonts from the same origin (../fonts/cc-icons.woff, 84,416 bytes, sha256 1a9b14799594702e4d0350164623d9e71261d70042ed4b3979808b08ba6e38b6); blocked by style-src on the staff-lab mirror while live Wikidot serves it; retained sweep in install/local/wikidot-verification/artifacts/cdnjs-cc-icons-external-origin-20261025.json (issue #2765)."
    },
    {
      origin: "https://indestructibletype-fonthosting.github.io",
      styles: true,
      fonts: true,
      evidence:
        "Indestructible Type's font-hosting GitHub Pages site. Both retained shared-corpus copies of `component:classified-decoration-base` `@import` `https://indestructibletype-fonthosting.github.io/renner.css` (EN capture b498634ff254edb806041276dbd088d8c9ed415d7fac1f05ff3dada1c21501d9, JP capture d0230d2f49ab3776d8d503367e06ba5d168a5fadcca7c8036af2331b5a5112e5), and current Wikidot loads both that stylesheet and its WOFF2 with HTTP 200 while Wikijump's `style-src` blocked them (issue #2213)."
    },
    {
      origin: "https://rokurolize.github.io",
      styles: true,
      fonts: true,
      evidence:
        "Rokurolize GitHub Pages host. Serves the published trees of the theme-port forks the SCP-JP theme work is based on (Rokurolize/Basalt, Rokurolize/sigma). The Basalt fork's published tree pairs its bedrock stylesheet (`https://rokurolize.github.io/Basalt/basalt-bedrock-min.css`) with the WOFF2 files under its `fonts/` directory, which the stylesheet `@font-face`s through relative URLs, so the font files load from this origin as well."
    },
    {
      origin: "https://hormress.github.io",
      styles: true,
      fonts: false,
      evidence:
        "Hormress GitHub Pages host for the Parallel theme family (theme:parallel and its JP port candidates). theme:parallel-jp and its derivatives theme:betwixt-jp, theme:normal-jp and theme:yore-jp @import the theme's stylesheets from this origin (Parallel/parallel-min.css, Parallel/normalize-min.css and the Parallel/branch/normal_projection/*.css widget and preset sheets); live Wikidot loads them, but framerail's page Content-Security-Policy blocked the stylesheet fetches on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep, leaving theme-decoration-sample-betwixt-jp and theme-decoration-sample-candela-jp (both Parallel-derived) on the default background. The same host's images are audited separately in WIKIDOT_IMAGE_SOURCES (sveltekit-options.ts). No font or script use from this origin was observed."
    },
    {
      origin: "https://bhl.scpwikicn.com",
      styles: true,
      fonts: false,
      evidence:
        "Black Highlighter's CN distribution host (the SCP-CN branch's BHL mirror). theme:highlighter-bhl @imports its base stylesheets from this origin (css/min/normalize.min.css and css/min/black-highlighter.min.css); live Wikidot loads them, but framerail's page Content-Security-Policy blocked the stylesheet fetches on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The served black-highlighter.min.css references no external files (every url() is a data: URI) and declares no @font-face, so no font use from this origin exists. The same host's logo image is audited separately in WIKIDOT_IMAGE_SOURCES (sveltekit-options.ts)."
    },
    {
      origin: "https://jonuarlreden.github.io",
      styles: true,
      fonts: false,
      evidence:
        "Jonuarlreden GitHub Pages host for the 'Polished Basalt' stylesheet set. theme:opinions-broadcaster-jp @imports its eight stylesheets from this origin (Polished-Basalt/p1-base.css, p2-styllization.css, p3-reverse-color.css, p4-new-feature.css, p5-anti-saving-page.css, p6-locallization.css, pc-hide-topbar.css and pd-buffed-hoverlinks.css); live Wikidot loads them, but framerail's page Content-Security-Policy blocked the stylesheet fetches on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep, so theme-decoration-sample-opinions-broadcaster-jp kept the unmodified Basalt shades. The served stylesheets declare no @font-face and reference no files on this origin (their url() targets are other admitted hosts), so no font or image use from this origin exists."
    },
    {
      origin: "https://hoah.backroomswiki.cn",
      styles: true,
      fonts: false,
      evidence:
        "Backrooms Wiki CN stylesheet host. theme:share-future-community and its sample @import the theme's main.css (SCP/theme-share-future-community/main.css) from this origin; live Wikidot loads it and the palette applies, but framerail's style-src blocked the fetch on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep, leaving both pages at the default palette. The CSP-STYLESRC audit confirmed the live @import and the in-browser style-src violation. No font use from this origin was observed."
    },
    {
      origin: "https://cdn.jsdmirror.com",
      styles: true,
      fonts: false,
      evidence:
        "jsDelivr mirror used by the supply-n-demand theme family. theme-decoration-sample-supply-n-demand @imports mcd-snd-mirror.css (WikidotTheme@v1.0.8/mcd-snd-mirror.css) from this origin; live Wikidot loads it and the h1 palette colour applies, but framerail's style-src blocked the fetch on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The CSP-STYLESRC audit confirmed the live @import and the in-browser style-src violation. No font use from this origin was observed."
    },
    {
      origin: "https://3nkv.github.io",
      styles: true,
      fonts: false,
      evidence:
        "3nkv GitHub Pages host for the Sodium theme. theme-decoration-sample-sodium @imports Sodium/sodium.min.css from this origin; live Wikidot loads it, but framerail's style-src blocked the fetch on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The CSP-STYLESRC audit confirmed the live @import and the in-browser style-src violation. No font use from this origin was observed."
    },
    {
      origin: "https://chinese-fonts-cdn.deno.dev",
      styles: true,
      fonts: false,
      evidence:
        "Deno Deploy Chinese-font stylesheet host. The dustframe, paradigm-inapplicable-sigma and suprematism decoration samples @import ZhuqueFangsong-Regular/result.css from this origin; live Wikidot references it, but framerail's style-src blocked the fetch on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The CSP-STYLESRC audit confirmed the live @import in all three themes and the in-browser style-src violation. No font use from this origin was observed."
    },
    {
      origin: "https://crimone.github.io",
      styles: true,
      fonts: false,
      evidence:
        "Crimone GitHub Pages host for the whz WenQuanYi typeface stylesheet set. The dustframe and paradigm-inapplicable-sigma decoration samples @import typefaces/whz/whz.css (which @imports its whz.1.css/whz.2.css subsets) from this origin; live Wikidot loads it, but framerail's style-src blocked the fetch on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The CSP-STYLESRC audit confirmed the live @import and the in-browser style-src violation. No font use from this origin was observed."
    },
    {
      origin: "https://fontsapi.zeoseven.com",
      styles: true,
      fonts: false,
      evidence:
        "Zeoseven font stylesheet API. theme:betwixt and its decoration sample @import 223/main/result.css from this origin; live Wikidot loads it, but framerail's style-src blocked the fetch on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The CSP-STYLESRC audit confirmed the live @import and the in-browser style-src violation. No font use from this origin was observed."
    },
    {
      origin: "https://github.backroomswiki.cn",
      styles: true,
      fonts: false,
      evidence:
        "Backrooms Wiki CN GitHub Pages host for the Super_Liminal stylesheets. theme-decoration-sample-decay @imports Super_Liminal/css/basic-styles.css from this origin; live Wikidot loads it and the palette applies, but framerail's style-src blocked the fetch on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The CSP-STYLESRC audit confirmed the live @import and the in-browser style-src violation (OC-G2-TRIPLET item B). No font use from this origin was observed."
    },
    {
      origin: "https://lemoncat233.github.io",
      styles: true,
      fonts: false,
      evidence:
        "Lemoncat GitHub Pages host, already audited for the Suprematism images in WIKIDOT_IMAGE_SOURCES. theme-decoration-sample-suprematism @imports the Suprematism stylesheet (supreroomartists/Suprematism/suprematism.css) from this origin; live Wikidot loads it, but framerail's style-src blocked the fetch on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The CSP-STYLESRC audit confirmed the live @import and the in-browser style-src violation; this entry grants styles only (the images remain in img-src). No font use from this origin was observed."
    },
    {
      origin: "https://oxygennine.github.io",
      styles: true,
      fonts: false,
      evidence:
        "Oxygennine GitHub Pages host for the Peroxide theme family. The peroxide and rima decoration samples @import Peroxide/peroxide.css (and its CSS/Interwiki sheets) from this origin; live Wikidot loads it and the palette applies, but framerail's style-src blocked the fetch on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The CSP-STYLESRC audit confirmed the live @import in both themes and the in-browser style-src violation (OC-G2-TRIPLET items B/C). No font use from this origin was observed."
    },
    {
      origin: "https://use.fontawesome.com",
      styles: true,
      fonts: false,
      evidence:
        "Font Awesome CDN used by theme stylesheets. existing:component-af2019theme @imports releases/v5.5.0/css/all.css from this origin; live Wikidot loads it, but framerail's style-src blocked the fetch on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The CSP-STYLESRC audit confirmed the live @import and the in-browser style-src violation. (A use.fontawesome.com reference in existing:theme-wanderers is only a [[code]] exhibit.) No font use from this origin was observed."
    },
    {
      origin: "https://xcninety.github.io",
      styles: true,
      fonts: false,
      evidence:
        "Xcninety GitHub Pages host for Korean web fonts. theme-decoration-sample-bulgunae @imports fonts/Cafe24Ohsquareair.css and fonts/IBMPlexSansKR-Regular.css from this origin (the live check-wiki page serves them as https); live Wikidot loads them, but framerail's style-src blocked the fetches on the staff-lab Sigma-10 site during the 2026-11-17 check-wiki parity sweep. The CSP-STYLESRC audit confirmed the live @import and the in-browser style-src violation. No font use from this origin was observed."
    }
  ])

export const auditedExternalAssetOrigins = (directive: "styles" | "fonts"): string[] =>
  AUDITED_EXTERNAL_ASSET_ORIGINS.filter((entry) => entry[directive]).map(
    (entry) => entry.origin
  )
