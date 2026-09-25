#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const portsDir=path.dirname(fileURLToPath(import.meta.url));
const campaign=JSON.parse(await fs.readFile(path.join(portsDir,'en-theme-campaign.json'),'utf8'));
const allThemes=['dear-dictator',...campaign.themes.map(item=>item.slug.replace(/^theme:/u,''))];
const selectedThemes=new Set(process.argv.slice(2).filter(arg=>arg.startsWith('--theme=')).map(arg=>arg.slice(8)));
const themes=selectedThemes.size?allThemes.filter(theme=>selectedThemes.has(theme)):allThemes;
if(selectedThemes.size&&themes.length!==selectedThemes.size)throw new Error(`unknown theme filter: ${[...selectedThemes].filter(theme=>!allThemes.includes(theme)).join(', ')}`);
const supportRule=`\n\n/* SCP-JP interaction adaptation: reveal Sigma's collapsed query input while the search control is hovered or keyboard-focused. */\n@media (min-width: 768px) {\n  #search-top-box-form:hover #search-top-box-input,\n  #search-top-box-form:focus-within #search-top-box-input {\n    display: inline-block !important;\n  }\n}\n`;
const supportModule=`\n\n[[module CSS]]\n/* SCP-JP interaction adaptation: reveal Sigma's collapsed query input while the search control is hovered or keyboard-focused. */\n@media (min-width: 768px) {\n  #search-top-box-form:hover #search-top-box-input,\n  #search-top-box-form:focus-within #search-top-box-input {\n    display: inline-block !important;\n  }\n}\n[[/module]]\n`;
const bedrockRule=`\n\n/* SCP-JP interactive acceptance: preserve Bedrock's navigation in the current Wikijump shell without letting its hover drawer cover the article/actions. */\n@media (min-width: 768px) {\n  #content-wrap { display: flex !important; align-items: flex-start; gap: 1rem; }\n  #side-bar { position: static !important; inset: auto !important; float: none !important; flex: 0 0 min(19rem, 30vw); width: min(19rem, 30vw) !important; max-width: none !important; height: auto !important; max-height: none; overflow: visible !important; transition: none !important; z-index: auto !important; }\n  #main-content { flex: 1 1 0; width: auto !important; min-width: 0; max-width: none !important; margin: 0 !important; }\n  #page-content { width: 100%; max-width: 100%; box-sizing: border-box; }\n}\n`;
const responsiveBreakpointRepairs={
 penumbra:`
/* The captured 768px tablet state sits between Penumbra's mobile and desktop header breakpoints: its fixed EN masthead and responsive JP navigation collide. Flow the existing localized identity, search, and mobile menu until the desktop header fits. */
@media (min-width: 768px) and (max-width: 900px) {
  #header { position: relative !important; display: flow-root !important; height: auto !important; min-height: 0 !important; max-width: 100vw !important; padding-block: .75rem !important; box-sizing: border-box !important; }
  #header h1, #header h2 { position: static !important; float: none !important; display: block !important; clear: both !important; width: auto !important; min-width: 0 !important; max-width: calc(100vw - 2rem) !important; height: auto !important; margin: .25rem 1rem !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; }
  #header h1 *, #header h2 * { white-space: normal !important; overflow-wrap: anywhere !important; }
  #search-top-box { position: static !important; inset: auto !important; float: none !important; clear: both !important; display: block !important; width: auto !important; max-width: calc(100vw - 2rem) !important; margin: .5rem 1rem 0 !important; box-sizing: border-box !important; }
  #search-top-box-form { position: static !important; display: flex !important; justify-content: flex-end !important; width: 100% !important; }
  #top-bar { display: block !important; height: auto !important; min-height: 0 !important; }
  #top-bar .top-bar { display: none !important; }
  .mobile-top-bar { position: relative !important; inset: auto !important; display: block !important; width: 100% !important; max-width: 100% !important; height: auto !important; min-height: 2.5rem !important; margin: .35rem 0 0 !important; }
  .mobile-top-bar > ul { position: static !important; inset: auto !important; display: flex !important; flex-wrap: wrap !important; align-items: center !important; width: 100% !important; height: auto !important; min-height: 0 !important; margin: 0 !important; }
}
`
};
const mobileHeaderAdaptationV2=`\n\n/* SCP-JP mobile-header adaptation revision 2: keep the search wrapper itself in flow; changing only its form leaves the theme's absolutely positioned parent overlaying the Japanese title. */\n@media (max-width: 767px) {\n  #header { height: auto !important; min-height: 0 !important; padding-bottom: .5rem; }\n  #header h1, #header h2 { display: block !important; position: static !important; float: none !important; clear: both !important; width: 100% !important; max-width: 100% !important; margin: .2rem 0 !important; line-height: 1.2 !important; box-sizing: border-box !important; }\n  #search-top-box { display: block !important; position: static !important; inset: auto !important; float: none !important; clear: both !important; width: 100% !important; max-width: 100% !important; margin: .5rem 0 0 !important; box-sizing: border-box !important; }\n  #search-top-box-form { display: flex !important; position: static !important; inset: auto !important; float: none !important; clear: both !important; justify-content: flex-end; width: 100% !important; max-width: 100% !important; margin: 0 !important; box-sizing: border-box !important; }\n  #search-top-box-input { display: inline-block !important; width: min(60vw, 14rem) !important; max-width: calc(100% - 3rem) !important; box-sizing: border-box !important; }\n  #top-bar { position: relative !important; inset: auto !important; width: 100% !important; max-width: 100% !important; margin: .35rem 0 0 !important; box-sizing: border-box !important; }\n}\n`;
const themeSpecificRules={
 bedrock:`${bedrockRule}\n/* Keep the runtime account control targetable while retaining Bedrock's compact avatar treatment. */\n#login-status { pointer-events: auto !important; }\n#login-status #account-options { pointer-events: auto !important; }\n`,
 basalt:`\n\n/* SCP-JP interaction adaptation: the inherited Basalt header disabled pointer events on the account control and menu. */\n#login-status, #login-status #account-options { pointer-events: auto !important; }\n`,
 foxtrot:`\n\n/* SCP-JP interaction adaptation: place the account menu below Foxtrot's header instead of clipping it above the viewport. */\n#login-status #account-options { top: calc(100% + .25rem) !important; right: 0 !important; z-index: 50 !important; }\n\n/* Keep Foxtrot's dark-plum and scarlet identity while restoring readable navigation and content links. */\n#side-bar a, #side-bar a:visited, #main-content a, #action-area a, .modalbox .credit a { color: #f0d9ff !important; text-decoration: underline; text-decoration-thickness: .06em; text-underline-offset: .14em; }\n#side-bar a:hover, #side-bar a:focus-visible, #main-content a:hover, #main-content a:focus-visible, #action-area a:hover, #action-area a:focus-visible, .modalbox .credit a:hover, .modalbox .credit a:focus-visible { color: #fff !important; background-color: #4a174e !important; outline: 2px solid #f0d9ff; outline-offset: 2px; }\n`,
 site:mobileHeaderAdaptationV2,
 wikifot:mobileHeaderAdaptationV2,
 'flopstyle-dark':`\n\n/* SCP-JP readability adaptation: retain the yellow header palette while making the account name readable on its bright header. */\n#login-status { color: #181818 !important; }\n\n/* Keep the theme's yellow menu panels while using a dark ink color with readable contrast. */\n#side-bar .side-block .heading, #side-bar .side-block .collapsible-block-link, #side-bar .side-block .collapsible-block-unfolded-link, #side-bar .side-block > a { color: #28220c !important; }\n`,
 skipos:`\n\n/* The imported Basalt mobile grid intentionally hides the secondary subtitle. The generic JP wrap rule had forced that absent grid item back on in a 48px implicit column, clipping text and intercepting navigation. Keep the mobile grid's authored hierarchy and make its compact search control a real touch target. */\n@media (max-width: 767px) { #header h2 { display: none !important; } #top-bar div.mobile-top-bar > ul, #top-bar div.mobile-top-bar > .open-menu { position: relative !important; z-index: 5 !important; } #search-top-box { z-index: 4 !important; } #search-top-box-form input[type=submit] { position: relative !important; z-index: 6 !important; width: 2rem !important; min-width: 2rem !important; height: 2rem !important; min-height: 2rem !important; line-height: 1 !important; } #search-top-box-form:focus-within #search-top-box-input { display: block !important; position: absolute !important; top: 0 !important; right: calc(100% + .25rem) !important; width: min(58vw, 13rem) !important; height: 2rem !important; z-index: 7 !important; } }\n\n/* Image review found muted Japanese drawer labels against SkipOS's dark navy panel. Keep the terminal palette and raise only the mobile navigation ink to its light foreground. */\n@media (max-width: 767px) { #side-bar .side-block a, #side-bar .side-block .heading, #side-bar .collapsible-block-link, #side-bar a.close-menu { color: #e4e5f3 !important; -webkit-text-fill-color: #e4e5f3 !important; } #side-bar .side-block a:hover, #side-bar .collapsible-block-link:focus-visible { color: #fff !important; } }\n`,
 'space':`\n\n/* SCP-JP credit acceptance: let the compact Rate control and its license link wrap as separate controls at phone widths while retaining the theme palette. */\n@media (max-width: 600px) { .creditRate, #u-credit-view .creditRate { display: flex !important; flex-wrap: wrap !important; align-items: center; gap: .5rem; } .creditRate .rate-box-with-credit-button, #u-credit-view .rate-box-with-credit-button { min-width: 0; } }\n`,
 '_jakstyle_credit':`\n\n/* SCP-JP credit acceptance: distinguish the license link from Jakstyle's red credit bar without changing its page palette. */\n.modalbox .credit a, #u-credit-otherwise .modalbox a { color: #fff !important; text-decoration: underline !important; text-underline-offset: .15em; }\n`,
 'minimalist-bhl':`\n\n/* Keep BHL sidebar navigation text and its close control readable on the selected crimson panel. */\n#side-bar .side-block, #side-bar .side-block * { color: rgb(var(--swatch-menutxt-light-color)) !important; }\n#side-bar .close-menu { color: rgb(var(--swatch-menutxt-light-color)) !important; }\n\n/* Keep the crimson interaction buttons while using the theme's light menu-text token for their labels. */\n#action-area .revision-diff-controls button { color: rgb(var(--swatch-menutxt-light-color)) !important; }\n`,
 jakstyle:`\n\n/* Preserve Jakstyle's burgundy History controls and make the Compare label readable on their dark fill. */\n#action-area .revision-diff-controls button { color: #fff !important; }\n`,
 monotypical:`\n\n/* SCP-JP interaction adaptation: give the zero-width account area a readable user label and a pointer-enabled menu. */\n#login-status { width: max-content !important; font-size: .875rem !important; pointer-events: auto !important; }\n#login-status .printuser { width: auto !important; font-size: inherit !important; }\n#login-status #account-options { pointer-events: auto !important; }\n\n/* The current shared credit:start modal has a 400px desktop width. Clamp the modal shell at SCP-JP's 320px policy boundary without shrinking desktop styling. */\n@media (max-width: 400px) {\n  #u-credit-view .modalcontainer, #u-credit-otherwise .modalcontainer { left: 50% !important; right: auto !important; width: calc(100vw - 1rem) !important; max-width: calc(100vw - 1rem) !important; min-width: 0 !important; transform: translateX(-50%) !important; box-sizing: border-box !important; }\n  #u-credit-view .modalbox, #u-credit-otherwise .modalbox { width: 100% !important; max-width: 100% !important; min-width: 0 !important; max-height: calc(100dvh - 2rem) !important; overflow: auto !important; box-sizing: border-box !important; overflow-wrap: anywhere; }\n}\n@media (max-width: 600px) { #u-credit-view .modalcontainer, #u-credit-otherwise .modalcontainer { top: 1rem !important; bottom: 1rem !important; height: auto !important; max-height: calc(100dvh - 2rem) !important; } #u-credit-view .modalbox, #u-credit-otherwise .modalbox { max-height: calc(100dvh - 2rem) !important; overflow-y: auto !important; } }\n`,
 redtape:`\n\n/* The source theme intentionally uses a white Wikidot error pane. Its bright theme accent is also used for dark-shell text and fails contrast on that white pane. */\n#odialog-container .owindow.error, #odialog-container .owindow.error #modal-title, #odialog-container .owindow.error .modal-body, #odialog-container .owindow.error .modal-message-extra { color: #24151a !important; }\n#odialog-container .owindow.error .button-close-message { color: #fff !important; }\n`,
 'ouroborous-theme':`\n\n/* Keep the Ouroborous neon sidebar treatment while preventing the JP long-label and toggle line boxes from colliding. */\n#side-bar .collapsible-block-link { color: rgb(var(--swatch-menutxt-light-color)) !important; line-height: 1.45 !important; margin-block: .45rem !important; padding: .35rem .25rem !important; overflow-wrap: anywhere; }\n#side-bar .collapsible-block-unfolded-link { line-height: 1.45 !important; }\n#side-bar .side-block .collapsible-block .collapsible-block-link { display: block !important; width: auto !important; max-width: 100% !important; box-sizing: border-box !important; font-size: 1rem !important; line-height: 1.4 !important; text-align: left !important; white-space: normal !important; overflow-wrap: anywhere !important; padding: .35rem .5rem !important; }\n\n/* SCP-JP interactive acceptance: Ouroborous small-text link contrast */\n#main-content a, #action-area a, #side-bar .side-block a { color: #ff858b !important; text-decoration: underline; text-decoration-thickness: .06em; text-underline-offset: .14em; }\n#main-content a:hover, #action-area a:hover, #side-bar .side-block a:hover, #main-content a:focus-visible, #action-area a:focus-visible, #side-bar .side-block a:focus-visible { color: #ffd1d3 !important; background: #281013 !important; outline: 2px solid #ff858b; outline-offset: 2px; }\n`,
 'dear-dictator':`\n\n/* SCP-JP visual acceptance: retain Dear Dictator's oxblood navigation panel while keeping Japanese navigation labels legible. */\n#side-bar .side-block, #side-bar .side-block a, #side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded-link { color: #fff0e8 !important; }\n#side-bar .side-block a:hover, #side-bar .collapsible-block-link:hover { color: #fff !important; background: #6d1420 !important; }\n\n/* The SCP-JP custom-theme policy requires the shared license area to remain available; Dear Dictator's upstream hide rule is not valid on the JP runtime. */\n#license-area { display: block !important; color: var(--text); }\n`,
 'isolated-terminal':`\n\n/* Japanese navigation labels must wrap inside the terminal menu instead of being cut off by its fixed row sizing. */\n#side-bar .side-block a, #side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded-link, #top-bar .top-bar li a { max-width: 100% !important; height: auto !important; min-height: 0 !important; line-height: 1.35 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; }\n#top-bar .top-bar li ul { height: auto !important; max-height: calc(100vh - 3rem) !important; overflow-y: auto; }\n`,
 'scp-offices-theme':`\n\n/* Keep SCP Offices navigation proportions while allowing long localized labels to wrap. */\n#side-bar .side-block a, #side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded-link { display: block; max-width: 100% !important; height: auto !important; white-space: normal !important; overflow-wrap: anywhere !important; line-height: 1.35 !important; box-sizing: border-box !important; }\n`,
 '_redtape_nav':`\n\n/* SCP-JP navigation contrast: the expanded red tape submenu needs light text over the theme's red panel. */\n#side-bar .collapsible-block-unfolded, #side-bar .collapsible-block-unfolded a, #side-bar .collapsible-block-unfolded-link { color: #fff0e8 !important; }\n#side-bar .collapsible-block-unfolded a:hover, #side-bar .collapsible-block-unfolded-link:hover { color: #fff !important; background-color: #651014 !important; }\n`,
 'extra-black-highlighter-theme':`\n\n/* BHL-derived sidebar uses the declared light menu-text token on its dark expanded section. */\n#side-bar .collapsible-block-unfolded, #side-bar .collapsible-block-unfolded a, #side-bar .collapsible-block-unfolded-link { color: rgb(var(--swatch-menutxt-light-color)) !important; }\n`,
 '_minimalist_bhl_nav':`\n\n/* Preserve Minimalist BHL's crimson tabs while separating their labels from the red fill and keeping nested menu text inside its panel. */\n#top-bar .top-bar a, #top-bar .top-bar a:visited { color: #fff0e8 !important; }\n#side-bar .collapsible-block-unfolded, #side-bar .collapsible-block-unfolded a { padding-inline-start: .5rem !important; white-space: normal !important; overflow-wrap: anywhere !important; }\n`,
 'turbo-vision':`\n\n/* Keep the cyan Turbo-Vision menu surface and use a dark ink for the red text links whose foreground blends into it. */\n#side-bar .side-block a, #side-bar .collapsible-block-unfolded a { color: #10252a !important; text-decoration: underline !important; }\n#side-bar .side-block a:hover, #side-bar .collapsible-block-unfolded a:hover { color: #071719 !important; background: #baf8f2 !important; }\n`,
 'aesthetic-theme':`\n\n/* The narrow Aesthetic submenu keeps its purple panel and uses a pale rose foreground with readable separation. */\n@media (max-width: 400px) { #side-bar .collapsible-block-unfolded, #side-bar .collapsible-block-unfolded a { color: #fff0fa !important; } }\n`,
 'much-cool':`\n\n/* Keep the dark Much Cool header while making its sidebar close affordance visible. */\n#side-bar .close-menu, #side-bar .close-menu a { color: #fff !important; }\n`,
 pataphysics:`\n\n/* SCP-JP credit acceptance: the upstream port hides the current SCP-JP heritage Rate wrapper with !important, although credit:start/end render a tagged heritage state. */\n.creditRate .rateBox.heritage-wrap { display: inline-flex !important; }\n`
};
const additionalThemeRules={
  jakstyle:`${themeSpecificRules._jakstyle_credit}\n\n/* Restore contrast in the opened Jakstyle sidebar while keeping its burgundy panels distinct. */\n#side-bar .side-block a, #side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded a { color: #fff0e8 !important; text-decoration: underline; text-underline-offset: .12em; }\n#side-bar .side-block a:hover, #side-bar .collapsible-block-link:hover { color: #fff !important; background: #65101b !important; }\n`,
  redtape:themeSpecificRules._redtape_nav,
  'minimalist-bhl':themeSpecificRules._minimalist_bhl_nav,
  'dear-dictator':`\n\n/* Visual follow-up: heading nodes have a stronger upstream selector than the sidebar wrapper; set the readable label color on each live navigation node. */\n#side-bar .side-block .heading, #side-bar .side-block a, #side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded-link { color: #fff0e8 !important; text-shadow: 0 1px 1px #3a0b0b; }\n`,
  site:`\n\n/* Keep Site's Foundation mark visible beside the longer local/SCP-JP site title instead of letting the title run through the logo. */\n@media (max-width: 767px) { #header h1, #header h2 { padding-left: 5rem !important; } }\n`,
  'night-rush-theme':`\n\n/* Image-reviewed SCP-JP masthead adaptation: the localized site name occupied the same 64px header band as Night Rush's Foundation emblem. Reserve the emblem's left column for both semantic title rows on phone widths, while preserving the upstream background art and typography. */\n@media (max-width: 767px) { #header h1 > a, #header h2 > span { padding-inline-start: 4.75rem !important; box-sizing: border-box !important; } }\n`,
  'flopstyle-dark':`\n\n/* Visual follow-up: the expanded submenu surface is yellow, so all labels on that panel need dark ink. */\n#side-bar .side-block a, #side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded a, #side-bar .collapsible-block-unfolded-link { color: #28220c !important; }\n#side-bar .side-block a:hover, #side-bar .collapsible-block-link:hover, #side-bar .collapsible-block-unfolded a:hover { color: #171200 !important; background: #fff68a !important; }\n`,
  monotypical:`\n\n/* Visual follow-up: constrain the credit modal to the visible viewport and scroll its own content so the return link is reachable. */\n@media (max-width: 600px) { #u-credit-view .modalcontainer, #u-credit-otherwise .modalcontainer { top: 1rem !important; bottom: 1rem !important; height: auto !important; max-height: calc(100dvh - 2rem) !important; } #u-credit-view .modalbox, #u-credit-otherwise .modalbox { max-height: calc(100dvh - 2rem) !important; overflow-y: auto !important; box-sizing: border-box !important; } }\n`,
  'scp-offices-theme':`\n\n/* The pale office menu needs its theme's dark ink on the collapsed submenu; localized labels can wrap without clipping. */\n#side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded-link { color: #23443b !important; white-space: normal !important; overflow-wrap: anywhere !important; line-height: 1.4 !important; }\n`,
  _ouroborous_theme_nav:`\n\n/* Bound every sidebar child link to the usable neon panel width so long Japanese labels wrap rather than disappear beyond its edge. */\n#side-bar .side-block a, #side-bar .collapsible-block-unfolded a { display: block !important; max-width: 100% !important; height: auto !important; min-height: 0 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; line-height: 1.4 !important; }\n`,
  hansarp:`\n\n/* The moving orange Hansarp credit stripe crosses the license link; lift the link on a small opaque label without removing the stripe. */\n#u-credit-view .modalbox .credit a, #u-credit-otherwise .modalbox .credit a { position: relative !important; z-index: 3 !important; display: inline-block !important; padding: .1em .25em !important; color: #15232b !important; background: #fff !important; text-decoration: underline !important; }\n`,
  inkblot:`\n\n/* Keep the other-license modal's final link and back control inside the 320px viewport and allow the modal itself to scroll. */\n@media (max-width: 600px) { #u-credit-otherwise .modalcontainer { top: 1rem !important; bottom: 1rem !important; height: auto !important; max-height: calc(100dvh - 2rem) !important; } #u-credit-otherwise .modalbox { max-height: calc(100dvh - 2rem) !important; overflow-y: auto !important; box-sizing: border-box !important; } #u-credit-otherwise .modalbox a[href="#u-credit-view"] { display: inline-block !important; white-space: nowrap !important; padding: .25rem !important; } }\n`,
  'minimalist-bhl':`${themeSpecificRules['minimalist-bhl']}\n${themeSpecificRules._minimalist_bhl_nav}\n\n/* Keep the attribution link above the strong crimson stripe and distinguish its text from the bar. */\n#u-credit-view .modalbox .credit a, #u-credit-otherwise .modalbox .credit a { position: relative !important; z-index: 3 !important; display: inline-block !important; padding: .1em .25em !important; color: #24151a !important; background: #fff !important; text-decoration: underline !important; }\n`,
  'ouroborous-theme':`${themeSpecificRules['ouroborous-theme']}\n\n/* At narrow widths keep Rate and the other-license link as separate flex items inside Ouroborous's modal instead of letting the neon control overlap its text. */\n#u-credit-view .creditRate, #u-credit-otherwise .creditRate { display: flex !important; position: static !important; flex-wrap: wrap !important; align-items: center; gap: .35rem; max-width: 100%; }\n@media (max-width: 600px) { #u-credit-view .modalbox, #u-credit-otherwise .modalbox { max-width: calc(100vw - 2rem) !important; box-sizing: border-box !important; overflow-x: auto !important; } }\n`,
  'y2k':`\n\n/* Keep the theme's square rating buttons while exposing their symbol text with a contrasting ink and minimum touch size. */\n.page-rate-widget-box .rateup a, .page-rate-widget-box .ratedown a, .page-rate-widget-box .cancel a, .creditRate .rateup a, .creditRate .ratedown a, .creditRate .cancel a { color: #171717 !important; font-weight: 700 !important; min-width: 1.5rem !important; min-height: 1.5rem !important; text-align: center !important; }\n`,
  'aesthetic-theme':`\n\n/* Keep the Aesthetic return link horizontal and reachable by scrolling when its translated modal content exceeds the phone viewport. */\n@media (max-width: 600px) { #u-credit-otherwise .modalcontainer { top: 1rem !important; bottom: 1rem !important; height: auto !important; max-height: calc(100dvh - 2rem) !important; } #u-credit-otherwise .modalbox { max-height: calc(100dvh - 2rem) !important; overflow-y: auto !important; } #u-credit-otherwise .modalbox a[href="#u-credit-view"] { display: inline-block !important; min-width: 3rem !important; white-space: nowrap !important; } }\n`,
  cosmonaut:`\n\n/* Keep the Cosmonaut starfield and cloud identity around the page, while giving the revision diff a quiet opaque reading surface so the decorative cloud layer cannot cross added/removed prose. */\n#action-area .revision-diff { position: relative !important; isolation: isolate; background-color: #071012 !important; }\n#action-area .revision-diff .revision-diff-line { position: relative; z-index: 1; }\n`,
  'mobile-header-themes':`\n\n/* SCP-JP mobile header adaptation: keep the localized identity and search within independent rows at the 320px policy boundary. */\n@media (max-width: 400px) { #header { height: auto !important; min-height: 0 !important; } #header h1, #header h2 { position: static !important; float: none !important; display: block !important; width: 100% !important; max-width: 100% !important; height: auto !important; line-height: 1.2 !important; overflow-wrap: anywhere !important; } #search-top-box { position: static !important; inset: auto !important; float: none !important; clear: both !important; display: block !important; width: 100% !important; max-width: 100% !important; margin: .5rem 0 0 !important; } #search-top-box-form { position: static !important; float: none !important; display: flex !important; justify-content: flex-end; width: 100% !important; } #top-bar { position: relative !important; inset: auto !important; width: 100% !important; max-width: 100% !important; margin: .35rem 0 0 !important; box-sizing: border-box !important; } }\n`
};
const evidenceDrivenVisualFixes={
  jakstyle:`
/* The credit link is rendered on a light license panel, not on the adjacent burgundy stripe; keep the text dark enough for that actual surface. */
.modalbox .credit a, #u-credit-otherwise .modalbox a { color: #5b1020 !important; background-color: #fff !important; text-decoration: underline !important; text-underline-offset: .15em; }
`,
  wikifot:`
/* The source moves the mobile drawer left by a fixed em value, leaving a visible strip when the live drawer exceeds that width. Use its own rendered width as the closed offset. */
@media (max-width: 767px) { #side-bar { left: -100% !important; max-width: 100vw !important; box-sizing: border-box !important; } #side-bar:target { left: 0 !important; width: min(16rem, 100vw) !important; } }
`,
  'isolated-terminal':`
/* Keep the mobile drawer close control on one line and separate its Japanese label from the terminal section heading. */
@media (max-width: 767px) { #side-bar:target { width: min(16rem, 100vw) !important; max-width: 100vw !important; box-sizing: border-box !important; overflow-x: hidden !important; } #side-bar .close-menu { position: relative !important; inset: auto !important; display: flex !important; justify-content: flex-end !important; width: 100% !important; max-width: 100% !important; height: auto !important; min-height: 2rem !important; white-space: nowrap !important; overflow-wrap: normal !important; word-break: keep-all !important; } #side-bar .side-block .heading { display: block !important; margin-block: .5rem .35rem !important; line-height: 1.4 !important; } #side-bar .side-block .collapsible-block-link { display: block !important; margin-block: .35rem !important; line-height: 1.4 !important; white-space: normal !important; overflow-wrap: anywhere !important; } }
`,
  'ouroborous-theme':`
/* Keep the submenu toggle below its section heading so the neon divider and Japanese text do not collide at 320px. */
@media (max-width: 767px) { #side-bar .side-block .heading { display: block !important; margin-block: .55rem .4rem !important; line-height: 1.35 !important; } #side-bar .side-block .collapsible-block-link { display: block !important; position: static !important; margin-block: .35rem !important; line-height: 1.4 !important; } }
`,
  'al-slop':`
/* The mobile theme title and localized site title occupy separate header rows; keep the long page title in the article column. */
@media (max-width: 767px) { #header { height: auto !important; min-height: 0 !important; } #header h1, #header h2 { position: static !important; float: none !important; display: block !important; width: 100% !important; max-width: 100% !important; height: auto !important; line-height: 1.2 !important; overflow-wrap: anywhere !important; } }
`,
  'extra-black-highlighter-theme':`
/* Keep the collapsed submenu affordance legible on the BHL-derived dark sidebar panel. */
#side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded-link { color: rgb(var(--swatch-menutxt-light-color)) !important; }
`,
  'scp-offices-theme':`
/* Office-theme submenu labels need the same dark ink as the pale gray-green panel behind them. */
#top-bar .top-bar ul, #top-bar .top-bar ul a { color: #233b34 !important; background-color: #e8ece9 !important; }
`,
  'bedrock':`
/* Opaque the open desktop dropdown so the article title underneath cannot merge with the last menu row. */
@media (min-width: 768px) { #top-bar .top-bar li ul { background-color: rgb(var(--swatch-menubg-color, 248, 248, 248)) !important; } }
`,
  basalt:`
/* Opaque the open desktop dropdown while retaining the Basalt menu palette. */
@media (min-width: 768px) { #top-bar .top-bar li ul { background-color: rgb(var(--swatch-menubg-color, 248, 248, 248)) !important; } }
`,
  'turbo-vision':`
/* FontAwesome is not a required SCP-JP runtime dependency; provide visible rate actions with theme-colored text glyphs. */
.page-rate-widget-box .rateup a::before, .creditRate .rateup a::before { content: "+" !important; font-family: inherit !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .ratedown a::before, .creditRate .ratedown a::before { content: "−" !important; font-family: inherit !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .cancel a::before, .creditRate .cancel a::before { content: "×" !important; font-family: inherit !important; font-size: .8rem !important; font-weight: 700 !important; }
`,
  y2k:`
/* Use readable text signs for Rate actions; the imported widget's empty legacy slots have no visible glyph in the current SCP-JP shell. */
.page-rate-widget-box .rateup a::before, .creditRate .rateup a::before { content: "+" !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .ratedown a::before, .creditRate .ratedown a::before { content: "−" !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .cancel a::before, .creditRate .cancel a::before { content: "×" !important; font-size: .8rem !important; font-weight: 700 !important; }
`,
  space:`
/* Keep the compact celestial Rate controls identifiable without depending on an icon-font asset. */
.page-rate-widget-box .rateup a::before, .creditRate .rateup a::before { content: "+" !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .ratedown a::before, .creditRate .ratedown a::before { content: "−" !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .cancel a::before, .creditRate .cancel a::before { content: "×" !important; font-size: .8rem !important; font-weight: 700 !important; }
`,
  penumbra:`
/* Keep Penumbra's compact Rate controls identifiable when the imported module's icon glyph is absent. */
.page-rate-widget-box .rateup a::before, .creditRate .rateup a::before { content: "+" !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .ratedown a::before, .creditRate .ratedown a::before { content: "−" !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .cancel a::before, .creditRate .cancel a::before { content: "×" !important; font-size: .8rem !important; font-weight: 700 !important; }
/* At the 768px policy tablet breakpoint, Penumbra's desktop masthead title, JP shell title, and responsive navigation occupy the same fixed rows. Flow the existing header elements and use the mobile navigation state until the desktop menu fits. */
@media (min-width: 768px) and (max-width: 900px) {
  #header { position: relative !important; display: flow-root !important; height: auto !important; min-height: 0 !important; max-width: 100vw !important; padding-block: .75rem !important; box-sizing: border-box !important; }
  #header h1, #header h2 { position: static !important; float: none !important; display: block !important; clear: both !important; width: auto !important; min-width: 0 !important; max-width: calc(100vw - 2rem) !important; height: auto !important; margin: .25rem 1rem !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; }
  #header h1 *, #header h2 * { white-space: normal !important; overflow-wrap: anywhere !important; }
  #search-top-box { position: static !important; inset: auto !important; float: none !important; clear: both !important; display: block !important; width: auto !important; max-width: calc(100vw - 2rem) !important; margin: .5rem 1rem 0 !important; box-sizing: border-box !important; }
  #search-top-box-form { position: static !important; display: flex !important; justify-content: flex-end !important; width: 100% !important; }
  #top-bar { display: block !important; height: auto !important; min-height: 0 !important; }
  .mobile-top-bar { position: relative !important; inset: auto !important; display: block !important; width: 100% !important; max-width: 100% !important; height: auto !important; min-height: 2.5rem !important; margin: .35rem 0 0 !important; }
  .mobile-top-bar > ul { position: static !important; inset: auto !important; display: flex !important; flex-wrap: wrap !important; align-items: center !important; width: 100% !important; height: auto !important; min-height: 0 !important; margin: 0 !important; }
}
`,
  scpedia:`
/* Give SCPedia's legacy blank Rate slots visible action glyphs in both ordinary and credited widgets. */
.page-rate-widget-box .rateup a::before, .creditRate .rateup a::before { content: "+" !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .ratedown a::before, .creditRate .ratedown a::before { content: "−" !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .cancel a::before, .creditRate .cancel a::before { content: "×" !important; font-size: .8rem !important; font-weight: 700 !important; }
`,
  inkblot:`
/* Keep the circular inkblot Rate controls visibly distinguishable as increase/decrease actions. */
.page-rate-widget-box .rateup a::before, .creditRate .rateup a::before { content: "+" !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .ratedown a::before, .creditRate .ratedown a::before { content: "−" !important; font-size: .8rem !important; font-weight: 700 !important; }
.page-rate-widget-box .cancel a::before, .creditRate .cancel a::before { content: "×" !important; font-size: .8rem !important; font-weight: 700 !important; }
`
};
const followupVisualFixes={
  foxtrot:`
/* Fit Foxtrot's localized site identity beside its circular logo on phone widths; the source gives the live site headings a desktop-sized left offset. */
@media (max-width: 767px) { #header { height: auto !important; min-height: 0 !important; } #header h1, #header h2 { position: static !important; float: none !important; clear: both !important; display: block !important; width: 100% !important; max-width: 100% !important; margin: .2rem 0 !important; padding-left: 4rem !important; box-sizing: border-box !important; line-height: 1.25 !important; overflow-wrap: anywhere !important; } #search-top-box { position: static !important; inset: auto !important; float: none !important; clear: both !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; } }
`,
  'al-slop':`
/* The collage is the theme identity; place the localized header labels and search in flow over it so they do not cover the article title. */
@media (max-width: 767px) { #header { height: auto !important; min-height: 0 !important; padding-bottom: .5rem; } #header h1, #header h2 { position: static !important; float: none !important; clear: both !important; display: block !important; width: 100% !important; max-width: 100% !important; height: auto !important; margin: .25rem 0 !important; line-height: 1.25 !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; } #search-top-box { position: static !important; inset: auto !important; float: none !important; clear: both !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; } }
`,
  'turbo-vision':`
/* The theme's pixel display font lacks Japanese vertical metrics; retain its face and palette but provide enough line box for translated headings and dialog messages. */
#main-content #page-title, #main-content #page-content h1, #main-content #page-content h2, #main-content #page-content h3, #odialog-container .owindow.error #modal-title, #odialog-container .owindow.error .modal-body { line-height: 1.45 !important; }
#odialog-container .owindow.error .modal-body { font-family: system-ui, "Noto Sans JP", sans-serif !important; overflow-wrap: anywhere !important; }
`,
  jakstyle:`
/* A red error pane cannot use Jakstyle's default black text; keep its red frame and use the same light ink as its close control. */
#odialog-container .owindow.error #modal-title, #odialog-container .owindow.error .modal-body, #odialog-container .owindow.error .modal-message-extra { color: #fff0e8 !important; }
`,
  'ouroborous-theme':`
/* Error text must read against Ouroborous's charcoal dialog while retaining the red warning frame. */
#odialog-container .owindow.error #modal-title, #odialog-container .owindow.error .modal-body, #odialog-container .owindow.error .modal-message-extra { color: #ffe8ea !important; }
`,
  'minimalist-bhl':`
/* SCP-JP action/file surfaces retain the crimson BHL bars but use the theme's light text token on those dark fills. */
.mobile-top-bar a, #page-options-bottom a, #page-options-bottom-2 a, #action-area .file-list button, #action-area .file-list a, #action-area .file-list label, #footer a, #license-area, #license-area a { color: #fff0e8 !important; }
`,
  'scp-offices-theme':`
/* Keep the dropdown paper-gray treatment while assigning a dark green-gray foreground with readable contrast. */
#top-bar .top-bar ul, #top-bar .top-bar ul a { color: #233b34 !important; }
`
};
const mobileHeaderVisualFixes={
  foxtrot:`
/* The source's zero-line-height header spans collapse the localized site title into the subtitle at phone widths. Keep both real SCP-JP labels readable in compact rows and retain Foxtrot's circular mark and TETON WY USA identity label. */
@media (max-width: 767px) {
  #header { min-height: 13rem !important; }
  #header h1, #header h2 { width: 100% !important; max-width: 100% !important; height: auto !important; margin: .15rem 0 !important; padding: 0 !important; text-align: center !important; line-height: 1.25 !important; }
  #header h1 > a { width: 100% !important; margin: 0 !important; color: #f1edf5 !important; font-size: .8rem !important; line-height: 1.25 !important; }
  #header h1 > a > span, #header h2 > span { display: block !important; height: auto !important; color: #f1edf5 !important; -webkit-text-fill-color: #f1edf5 !important; font-size: .8rem !important; line-height: 1.25 !important; text-shadow: none !important; }
  #header h1 > a::before { content: none !important; }
  #header h1 > a::after { top: 4rem !important; }
  #header h2::before { display: none !important; }
  #search-top-box { position: static !important; inset: auto !important; width: 100% !important; max-width: 100% !important; margin-top: .5rem !important; }
}
`,
  'al-slop':`
/* Keep the poster header's authored vertical space on phones: its logo and search are in flow, while the original top bar and account box are positioned over the banner. Reserve that header area before the article title begins. */
@media (max-width: 767px) {
  #header { min-height: 16rem !important; height: auto !important; padding-bottom: 1rem !important; }
  #top-bar { position: relative !important; inset: auto !important; top: auto !important; left: auto !important; width: 100% !important; margin-top: .5rem !important; }
  #login-status { position: relative !important; inset: auto !important; top: auto !important; right: auto !important; margin: .5rem 0 0 auto !important; }
}
`
  ,inkblot:`
/* The current 320px other-license image shows only a sliver of the return control at the modal's lower edge. Keep the existing scrollable modal, but return the back affordance to normal flow as a full-width-readable button. */
@media (max-width: 600px) { #u-credit-otherwise .modalbox a[href="#u-credit-view"] { position: static !important; float: none !important; display: inline-flex !important; align-items: center !important; justify-content: center !important; min-width: 4.5rem !important; min-height: 2.4rem !important; margin: .75rem auto .35rem !important; padding: .35rem .55rem !important; line-height: 1.3 !important; white-space: nowrap !important; clear: both !important; } #u-credit-otherwise .modalbox { padding-bottom: 1rem !important; } }
`
};
const mobileHeaderRefinements={
  skipos:`
/* The authored circular OS mark overlays the mobile h1 grid cell. Keep the theme mark and let the complete OS label fit in its adjacent title slot. */
@media (max-width: 767px) { #header h1, #header h1 > a { min-width: 0 !important; max-width: 100% !important; font-size: .68rem !important; letter-spacing: 0 !important; white-space: nowrap !important; } }
`,
  'black-highlighter-theme':`
/* The inherited mobile drawer clips its close label against the screen edge; reserve a small inner text inset while retaining the full-screen dimmer anchor. */
@media (max-width: 767px) { #side-bar a.close-menu { padding-inline-start: .65rem !important; box-sizing: border-box !important; } }
`,
  bedrock:`
/* Keep the drawer close label inside the viewport while the full-screen close anchor continues to dim the page. */
@media (max-width: 767px) { #side-bar a.close-menu { padding-inline-start: .65rem !important; box-sizing: border-box !important; } }
`,
  basalt:`
/* Keep the drawer close label inside the viewport while the full-screen close anchor continues to dim the page. */
@media (max-width: 767px) { #side-bar a.close-menu { padding-inline-start: .65rem !important; box-sizing: border-box !important; } }
`,
  scpedia:`
/* Keep the drawer close label inside the viewport while the full-screen close anchor continues to dim the page. */
@media (max-width: 767px) { #side-bar a.close-menu { padding-inline-start: .65rem !important; box-sizing: border-box !important; } }
`,
  'al-slop':`
/* The close label is painted against the left viewport edge by the banner theme's mobile drawer; inset its text without suppressing the overlay. */
@media (max-width: 767px) { #side-bar a.close-menu { padding-inline-start: .65rem !important; box-sizing: border-box !important; } #license-area { background: rgba(255,255,255,.94) !important; color: #242018 !important; padding: .65rem !important; } #license-area a { color: #603b12 !important; text-decoration: underline !important; } }
`,
  scheme:`
/* The decorative gear overlaps the live site wordmark on narrow screens. Reserve the logo band, then lay the localized identity below it while preserving the original masthead art. */
@media (max-width: 600px) { #header { height: auto !important; min-height: 18rem !important; padding-top: 10rem !important; box-sizing: border-box !important; } #header h1, #header h2 { position: static !important; float: none !important; clear: both !important; display: block !important; width: 100% !important; max-width: 100% !important; height: auto !important; margin: .25rem 0 !important; padding: 0 !important; transform: none !important; line-height: 1.25 !important; box-sizing: border-box !important; } #header h1 a { display: block !important; position: static !important; height: auto !important; max-height: none !important; margin: 0 !important; padding: 0 !important; line-height: 1.25 !important; font-size: 1.15rem !important; } #header h1 a:before { display: block !important; content: var(--title) !important; color: #f2f2f2 !important; text-shadow: 2px 2px 2px #000 !important; } #header h2:after { display: block !important; content: var(--short_subtitle, var(--subtitle)) !important; white-space: normal !important; color: #f0f0c0 !important; text-shadow: 1px 1px 1px rgba(0,0,0,.8) !important; } #header h2 span { display: none !important; } }
/* The 390px mobile navigation was present but its hit target sat beneath the positioned gear decoration (div#extra-div-2, z-index 20). Keep the theme artwork intact and raise the actual navigation control above that decoration. */
@media (max-width: 767px) { #top-bar .mobile-top-bar { position: relative !important; z-index: 21 !important; } #top-bar .mobile-top-bar .open-menu { position: relative !important; z-index: 22 !important; } }
`,
  'minimalist-bhl':`
/* BHL's burgundy panel leaves the shared danger-colored Close label dark; use the existing light menu-text token on the control only. */
@media (max-width: 600px) { #action-area .action-area-close { color: rgb(var(--swatch-menutxt-light-color)) !important; } }
`,
  'ouroborous-theme':`
/* Preserve the near-black action panel while making its dark red action labels identifiable. */
@media (max-width: 767px) { #page-options-bottom a, #page-options-bottom-2 a { color: #ff929e !important; text-decoration: underline !important; text-underline-offset: .12em; } #page-options-bottom a:hover, #page-options-bottom-2 a:hover { color: #fff !important; } }
`,
  'scp-offices-theme':`
/* Fit the Japanese credit-view return affordance inside the existing SCP Offices card without changing its office-panel colors. */
@media (max-width: 600px) { #u-credit-otherwise .modalbox > a[href="#u-credit-view"], #u-credit-otherwise a[href="#u-credit-view"] { display: inline-block !important; min-width: 0 !important; max-width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; line-height: 1.3 !important; padding: .4rem .55rem !important; box-sizing: border-box !important; } #u-credit-view .modalbox-title, #u-credit-view .credit a, #u-credit-otherwise .modalbox-title, #u-credit-otherwise .modalbox a { color: #304b40 !important; } }
`,
  redtape:`
/* Keep the localized credit return label on one usable control at phone widths while retaining Redtape's red treatment. */
@media (max-width: 600px) { #u-credit-otherwise .modalbox > a[href="#u-credit-view"], #u-credit-otherwise a[href="#u-credit-view"] { display: inline-block !important; min-width: 0 !important; max-width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; line-height: 1.3 !important; padding: .4rem .55rem !important; box-sizing: border-box !important; } }
`,
  paperstack:`
/* Paperstack's pale display fill and account label wash out on the local JP white header. Keep the paper palette while using readable brown ink for the live Japanese shell identity. */
@media (max-width: 767px) { #header h1 > a, #header h1 > a > span, #header h2 > span, #login-status { color: #4b412d !important; -webkit-text-fill-color: #4b412d !important; text-shadow: 0 1px 0 #fff !important; } }
`,
  skipos:`
/* Skipos' white-header wordmark has a near-white fill and disappears against SCP-JP's white mobile shell. Preserve its display face and assign the theme's deep blue ink. */
@media (max-width: 767px) { #header h1 > a, #header h1 > a > span, #header h2 > span, #login-status { color: #24365f !important; -webkit-text-fill-color: #24365f !important; text-shadow: 0 1px 0 #fff !important; } }
`,
  jakstyle:`
/* Jakstyle's dark masthead paints the live site name in a nearly identical dark red. Keep its red-on-black identity with a light red accessible heading ink. */
@media (max-width: 767px) { #header h1 > a, #header h1 > a > span, #header h2 > span { color: #ffe3e6 !important; -webkit-text-fill-color: #ffe3e6 !important; text-shadow: 0 1px 0 #4e0710 !important; } }
@media (max-width: 600px) { #u-credit-otherwise .modalbox > a[href="#u-credit-view"], #u-credit-otherwise a[href="#u-credit-view"] { display: inline-block !important; min-width: 0 !important; max-width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; line-height: 1.3 !important; padding: .4rem .55rem !important; box-sizing: border-box !important; } }
`,
  'turbo-vision':`
/* The pixel theme's fixed narrow return button turns the Japanese credit label into stacked fragments; let it wrap as a normal compact control. */
@media (max-width: 600px) { #u-credit-otherwise .modalbox > a[href="#u-credit-view"], #u-credit-otherwise a[href="#u-credit-view"] { display: inline-block !important; min-width: 0 !important; max-width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; line-height: 1.3 !important; padding: .4rem .55rem !important; box-sizing: border-box !important; } }
`,
  wikifot:`
/* The source's pale display lettering loses contrast on the SCP-JP white header. Preserve the outlined Wikifot typography but give the Japanese runtime labels a visible slate fill. */
@media (max-width: 767px) { #header h1 > a, #header h1 > a > span, #header h2 > span { color: #3f4650 !important; -webkit-text-fill-color: #3f4650 !important; text-shadow: 0 1px 0 #fff, 0 0 2px #fff !important; } #login-status { color: #27313c !important; } }
`,
  classic:`
/* The inherited Classic navigation uses white label ink on a pale mobile header. Keep the restrained light panel and restore dark readable navigation labels. */
@media (max-width: 767px) { #top-bar a, #top-bar a:visited { color: #252525 !important; } #top-bar a:hover, #top-bar a:focus-visible { color: #111 !important; background: #dedede !important; } }
`,
  foxtrot:`
/* Keep the Foxtrot type label between the site's title and subtitle instead of painting over either localized line. */
@media (max-width: 767px) { #header::after { content: none !important; } #header h1 > a::after { top: 5.35rem !important; } }
`
};
const mobileHeaderLayoutCorrections={
  paperstack:`
/* The rendered Japanese Paperstack site title and subtitle share the source theme's compact display grid and overlap at phone widths. Keep its Josefin paper heading style, but put the two semantic labels and search control into distinct natural rows. */
@media (max-width: 767px) {
  #header { display: flow-root !important; position: relative !important; height: auto !important; min-height: 0 !important; padding-block: .75rem !important; box-sizing: border-box !important; }
  #header h1, #header h2 { display: block !important; position: static !important; float: none !important; clear: both !important; grid-row: auto !important; grid-column: auto !important; width: 100% !important; max-width: 100% !important; height: auto !important; min-height: 0 !important; margin: .35rem 0 !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; }
  #header h1 > a, #header h2 > span { display: block !important; position: static !important; width: 100% !important; max-width: 100% !important; height: auto !important; min-height: 0 !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; }
  #search-top-box { display: block !important; position: static !important; inset: auto !important; float: none !important; clear: both !important; width: 100% !important; max-width: 100% !important; margin: .5rem 0 0 !important; box-sizing: border-box !important; }
}
`,
  foxtrot:`
/* Reflow the real localized site name and subtitle above the Foxtrot label; the source positioned its generated label twice and reserved desktop-sized anchor height. */
@media (max-width: 767px) {
  #header { min-height: 14rem !important; }
  #header h1 { height: 1.4rem !important; overflow: visible !important; }
  #header h1, #header h2 { margin: .1rem 0 !important; padding: 0 !important; line-height: 1.25 !important; }
  #header h1 > a { display: block !important; position: static !important; width: 100% !important; height: 1.4rem !important; margin: 0 !important; color: #f1edf5 !important; font-size: .8rem !important; line-height: 1.25 !important; text-align: center !important; }
  #header h1 > a > span, #header h2 > span { display: block !important; height: auto !important; color: #f1edf5 !important; -webkit-text-fill-color: #f1edf5 !important; font-size: .8rem !important; line-height: 1.25 !important; }
  #header h1 > a::after { content: none !important; }
  #header::after { content: "TETON WY USA" !important; position: absolute !important; top: 4.5rem !important; left: 50% !important; transform: translateX(-50%) !important; color: var(--header-txt-color) !important; font: 700 .9rem/1.3 Arial, sans-serif !important; white-space: nowrap !important; pointer-events: none !important; }
  #header h2::before { display: none !important; }
  #search-top-box { position: static !important; inset: auto !important; width: 100% !important; max-width: 100% !important; margin-top: 3.25rem !important; }
}
`
};
const mobileHeaderFlowRepairs={
  foxtrot:`
/* The legacy logo anchor keeps a 142px inner line box despite a short heading. Position the actual site name in its semantic heading row and return the account controls to document flow so neither overlays the title. */
@media (max-width: 767px) {
  #header h1 { position: relative !important; }
  #header h1 > a > span { position: absolute !important; top: 0 !important; left: 0 !important; right: 0 !important; width: 100% !important; text-align: center !important; }
  #login-status { position: static !important; inset: auto !important; width: max-content !important; max-width: 100% !important; margin: .35rem 0 0 auto !important; }
}
`
};
const mobileHeaderNarrowRepairs={
  foxtrot:`
/* At the policy boundary the long subtitle wraps under the fixed hamburger. Put that subtitle below the logo's touch target and move its theme label with it. */
@media (max-width: 360px) { #header h2 { margin-top: 1.35rem !important; } #header::after { top: 6.25rem !important; } #header { min-height: 15rem !important; } }
`
};
const mobileHeaderVisualAcceptanceV10={
  penumbra:`
/* Reviewed mobile image shows Penumbra's dark masthead graphic behind the live Japanese site identity. Use its high-contrast light ink at phone widths; preserve the low-light article palette and circular mark. */
@media (max-width: 767px) { #header h1, #header h2, #header h1 > a, #header h1 > a > span, #header h2 > span, #login-status, #login-status * { color: #f1edf5 !important; -webkit-text-fill-color: #f1edf5 !important; text-shadow: 0 1px 3px #17171d !important; } }
`,
  paperstack:`
/* The 390px capture exposed an 80px top padding on the logo anchor: the Japanese site title overflows its heading box into the subtitle. Keep the paper display face, but restore natural line-box flow. */
@media (max-width: 767px) { #header { display: flow-root !important; position: relative !important; height: auto !important; min-height: 0 !important; } #header h1, #header h2 { display: block !important; position: static !important; float: none !important; clear: both !important; grid-row: auto !important; grid-column: auto !important; height: auto !important; min-height: 0 !important; margin-block: .4rem !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; } #header h1 > a, #header h2 > span { display: block !important; position: static !important; height: auto !important; min-height: 0 !important; padding: 0 !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; } }
`,
  skipos:`
/* The 390px screenshot showed the authored SkipOS logo rendered at desktop scale over its wordmark. Keep the OS mark and theme label, sized to the mobile header row. */
@media (max-width: 767px) { #header { --header-logo-size: 2rem !important; } #header h1, #header h1 > a { min-width: 0 !important; max-width: 100% !important; font-size: .8rem !important; } #header h1 > a::before { width: 2rem !important; min-width: 2rem !important; height: 2rem !important; background-size: contain !important; } #header h1 > a > span::before { font-size: .8rem !important; } }
`
};
const interactionSurfaceVisualFixesV1={
  classic:`
/* The 390/320 screenshots show the Japanese masthead under the floating menu control and the two-line tagline crossing a fixed-height stripe. Reserve the hamburger column and let the stripe grow with wrapped text. */
@media (max-width: 767px) { #header h1 { padding-inline-start: 3.5rem !important; box-sizing: border-box !important; } #header h2 { height: auto !important; min-height: 2rem !important; max-height: none !important; padding-block: .25rem !important; line-height: 1.35 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; } #header h2 > span { display: block !important; height: auto !important; max-height: none !important; line-height: 1.35 !important; white-space: normal !important; overflow-wrap: anywhere !important; } }
`,
  'black-highlighter-theme':`
/* Keep BHL's credit return action as one compact Japanese control instead of splitting it across vertical lines at phone widths. */
@media (max-width: 600px) { #u-credit-otherwise .modalbox a[href="#u-credit-view"] { display: inline-flex !important; width: max-content !important; min-width: 0 !important; max-width: 100% !important; white-space: nowrap !important; word-break: keep-all !important; overflow-wrap: normal !important; line-height: 1.25 !important; } }
`,
  sigma:`
/* Keep Sigma's credit return action as one readable Japanese control at phone widths. */
@media (max-width: 600px) { #u-credit-otherwise .modalbox a[href="#u-credit-view"] { display: inline-flex !important; width: max-content !important; min-width: 0 !important; max-width: 100% !important; white-space: nowrap !important; word-break: keep-all !important; overflow-wrap: normal !important; line-height: 1.25 !important; } }
`
};
const headerOverlapVisualFixesV2={
  paperstack:`
/* The regenerated image and box probe showed both headings had zero-height boxes while their text overflowed; flow-root makes the heading boxes contain their wrapped Japanese/English labels. Keep the account in its own row. */
@media (max-width: 767px) { #header { padding-top: 2.25rem !important; box-sizing: border-box !important; } #header h1, #header h2 { display: flow-root !important; height: auto !important; min-height: 1.25em !important; margin: .45rem 0 !important; line-height: 1.25 !important; } #header h1 > a, #header h1 > a > span, #header h2 > span { display: block !important; height: auto !important; min-height: 1.25em !important; line-height: 1.25 !important; } #header #login-status { position: absolute !important; top: .35rem !important; right: 0 !important; max-width: calc(100% - 3rem) !important; } }
`,
  classic:`
/* The reviewed 390px image showed the two-line Japanese tagline crossing the theme's thin dark stripe; the heading's zero-height box let it overlay the next header item. Contain the wrapped line box and keep the stripe behind every line. */
@media (max-width: 767px) { #header h2 { display: flow-root !important; position: relative !important; z-index: 1 !important; height: auto !important; min-height: 1.35em !important; max-height: none !important; margin-top: 1.5rem !important; padding: .45rem .5rem !important; color: #ffb0b8 !important; -webkit-text-fill-color: #ffb0b8 !important; background: #252525 !important; line-height: 1.35 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; } #header h2 > span { display: block !important; height: auto !important; max-height: none !important; color: inherit !important; -webkit-text-fill-color: inherit !important; line-height: inherit !important; } }
`
};
const headerAndNavigationVisualFixesV3={
  paperstack:`
/* The zero-height headings were still winning via the legacy grid treatment. Contain their line boxes before laying out the long local-site title. */
@media (max-width: 767px) { #header h1, #header h2 { display: flow-root !important; height: auto !important; min-height: 1.25em !important; line-height: 1.25 !important; } #header h1 > a, #header h1 > a > span, #header h2 > span { display: block !important; height: auto !important; min-height: 1.25em !important; line-height: 1.25 !important; } }
`,
  classic:`
/* The original classic masthead puts the subtitle on a thin stripe. Make the subtitle's zero-height heading contain its lines so the fixture site title cannot start immediately after “Protect”. */
@media (max-width: 767px) { #header h2 { display: flow-root !important; height: auto !important; min-height: 1.35em !important; margin-bottom: 1.25rem !important; } #header h2 > span { display: block !important; } }
`,
  y2k:`
/* Y2K's 390px screenshot shows the two localized labels sharing the logo's legacy fixed header stack. Give both headings real line boxes and reduce only the mobile subtitle scale to keep the shield and article boundary clear. */
@media (max-width: 767px) { #header { height: auto !important; min-height: 0 !important; padding-bottom: 1rem !important; } #header h1, #header h2 { display: flow-root !important; position: relative !important; float: none !important; clear: both !important; width: auto !important; max-width: calc(100vw - 2.5rem) !important; height: auto !important; min-height: 1.2em !important; max-height: none !important; margin: .5rem auto !important; line-height: 1.2 !important; white-space: normal !important; overflow-wrap: anywhere !important; } #header h1 > a, #header h1 > a > span, #header h2 > span { display: block !important; position: static !important; width: auto !important; height: auto !important; min-height: 1.2em !important; line-height: inherit !important; white-space: normal !important; overflow-wrap: anywhere !important; } #header h2, #header h2 > span { font-size: clamp(1rem, 5vw, 1.35rem) !important; } }
`,
  jakstyle:`
/* The cog is intentional Jakstyle artwork, but at phone width its full-size background sits over the live site wordmark. Keep the cog as a faint right-side watermark so the branded title remains readable. */
@media (max-width: 767px) { #header { position: relative !important; } #header::before { background-position: right center !important; background-size: auto 72% !important; opacity: .08 !important; pointer-events: none !important; } #header h1, #header h2 { position: relative !important; z-index: 1 !important; } }
`,
  skipos:`
/* The Basalt-derived header logo selector has two IDs; the earlier one-ID size rule did not win. Keep the SkipOS symbol but use the mobile header's actual logo pseudo-element size. */
@media (max-width: 767px) { #header#header h1 a::before { width: 2rem !important; min-width: 2rem !important; height: 2rem !important; background-size: 2rem !important; } #header#header h1 a { padding-inline: .4rem !important; } }
`,
  'night-rush-theme':`
/* The current mobile masthead overlays its subtitle on the title because both legacy heading boxes collapse. Restore natural heading flow while keeping the night-sky mark and the dark title treatment. */
@media (max-width: 767px) { #header { height: auto !important; min-height: 0 !important; padding-block: 2.5rem .75rem !important; } #header h1, #header h2 { display: flow-root !important; position: relative !important; float: none !important; clear: both !important; width: auto !important; max-width: calc(100vw - 2rem) !important; height: auto !important; min-height: 1.25em !important; max-height: none !important; margin: .4rem auto !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; } #header h1 > a, #header h1 > a > span, #header h2 > span { display: block !important; position: static !important; width: auto !important; height: auto !important; min-height: 1.25em !important; line-height: inherit !important; white-space: normal !important; overflow-wrap: anywhere !important; } }
`,
  monotypical:`
/* The visible upstream wordmark is #header h1 a::before; the hidden span selector does not affect it. Keep whole words intact at the SCP-JP 320px boundary while preserving the Monotypical face. */
@media (max-width: 360px) { #header h1 a::before { white-space: normal !important; overflow-wrap: normal !important; word-break: normal !important; hyphens: none !important; font-size: clamp(1rem, 6.5vw, 1.25rem) !important; letter-spacing: -.035em !important; } }
`,
  'flopstyle-dark':`
/* The opened slate drawer has dark inherited links on a dark panel. Use the theme's warm light text for navigation only and keep its yellow hover state. */
#side-bar .side-block a, #side-bar .side-block .heading, #side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded a, #side-bar .collapsible-block-unfolded-link { color: #f1ead7 !important; -webkit-text-fill-color: #f1ead7 !important; text-decoration: underline !important; text-underline-offset: .12em; }
#side-bar .side-block a:hover, #side-bar .collapsible-block-link:hover, #side-bar .collapsible-block-unfolded a:hover { color: #171200 !important; -webkit-text-fill-color: #171200 !important; background: #fff68a !important; }
`,
  'turbo-vision':`
/* Keep the Turbo-Vision cyan drawer and prevent its small Japanese labels from inheriting the upstream pale foreground on that light surface. */
@media (max-width: 767px) { #side-bar .side-block a, #side-bar .side-block .heading, #side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded a { color: #082c31 !important; -webkit-text-fill-color: #082c31 !important; text-decoration: underline !important; } #side-bar .side-block a:hover, #side-bar .collapsible-block-link:focus-visible { color: #071719 !important; background: #baf8f2 !important; } }
`
};
const headerLayeringRepairsV4={
  paperstack:`
/* Each title has two wrapped lines, but the anchor kept only one line of intrinsic height. Let the display blocks reserve their complete wrapped height so the subtitle follows the title instead of painting over it. */
@media (max-width: 767px) { #header h1, #header h2, #header h1 > a, #header h1 > a > span, #header h2 > span { height: max-content !important; min-height: max-content !important; } }
`,
  classic:`
/* Classic replaces the live subtitle with its pseudo-element motto. Keep the source text visually hidden as the upstream theme intended, while giving the custom motto a readable row and separating it from page content. */
@media (max-width: 767px) { #header h2 > span { color: transparent !important; -webkit-text-fill-color: transparent !important; font-size: 0 !important; height: max-content !important; min-height: max-content !important; } #header h2 > span::before { display: block !important; color: #ffb0b8 !important; -webkit-text-fill-color: #ffb0b8 !important; font-size: clamp(1rem, 5vw, 1.25rem) !important; line-height: 1.35 !important; } #header h2 { height: max-content !important; min-height: max-content !important; margin-bottom: 1.5rem !important; } }
`,
  y2k:`
/* Y2K uses a pseudo-element as its themed subtitle. Hide the local-site description text without hiding that pseudo-element, and reserve its full wrapped height above the shield. */
@media (max-width: 767px) { #header h1, #header h1 > a, #header h1 > a > span, #header h2, #header h2 > span { height: max-content !important; min-height: max-content !important; } #header h2 > span { color: transparent !important; -webkit-text-fill-color: transparent !important; font-size: 0 !important; } #header h2 > span::before { display: block !important; color: #fff !important; -webkit-text-fill-color: #fff !important; font-size: clamp(1rem, 5vw, 1.3rem) !important; line-height: 1.25 !important; } }
`
};
const imageReviewRepairs={
  'isolated-terminal':`
/* The mobile drawer places its collapsed toggle at zero-width absolute coordinates; restore the real label to flow so it cannot collide with the next section heading. */
@media (max-width: 767px) {
  #side-bar:target .side-block .collapsible-block { display: block !important; position: relative !important; width: 100% !important; height: auto !important; margin-block: .5rem !important; }
  #side-bar:target .side-block .collapsible-block-link { display: block !important; position: static !important; inset: auto !important; width: auto !important; min-width: 0 !important; max-width: 100% !important; height: auto !important; margin: .35rem 0 !important; padding: .4rem .25rem !important; line-height: 1.55 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; }
  #side-bar:target .side-block .collapsible-block-unfolded { position: static !important; height: auto !important; min-height: 0 !important; margin-block: .35rem .75rem !important; }
  #side-bar:target .side-block .heading { margin-block: .75rem .45rem !important; line-height: 1.5 !important; }
}
`,
  'minimalist-bhl':`
/* Screenshots show near-black copy disappearing against the crimson quotation and license panels; retain the red surfaces and raise text/link ink contrast. */
#page-content blockquote, #page-content blockquote *, #page-content .blockquote, #page-content .blockquote * { color: #fff0e8 !important; }
#footer, #footer *, #license-area, #license-area * { color: #fff0e8 !important; }
#footer a, #license-area a { text-decoration: underline !important; text-decoration-thickness: .06em; text-underline-offset: .14em; }
`,
  penumbra:`
/* The reviewed mobile JP shell paints the Penumbra masthead over its dark graphic field; keep the localized header ink light there and allow both labels to wrap within the viewport. */
@media (max-width: 400px) {
  #header { width: 100% !important; max-width: 100vw !important; box-sizing: border-box !important; }
  #header h1, #header h2, #header h1 a, #header h1 span, #header h2 span { width: 100% !important; max-width: 100% !important; color: #f1edf5 !important; -webkit-text-fill-color: #f1edf5 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; text-shadow: 0 1px 3px #17171d !important; }
  #login-status, #login-status * { color: #f1edf5 !important; -webkit-text-fill-color: #f1edf5 !important; }
}
`,
  space:`
/* The phone screenshot clips the long live site title at its intrinsic nowrap width; let the existing celestial heading treatment wrap without removing its starfield or accent. */
@media (max-width: 400px) {
  #header { width: 100% !important; max-width: 100vw !important; box-sizing: border-box !important; }
  #header h1, #header h2, #header h1 a, #header h1 span, #header h2 span { display: block !important; width: 100% !important; max-width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; word-break: normal !important; box-sizing: border-box !important; }
}
`,
  'ouroborous-theme':`
/* The other-license modal's return affordance collapsed into a narrow vertical button at 320px; reserve enough inline space for the Japanese label. */
@media (max-width: 600px) { #u-credit-otherwise .modalbox a[href="#u-credit-view"] { display: inline-flex !important; align-items: center !important; justify-content: center !important; flex: 0 0 auto !important; width: auto !important; min-width: 4rem !important; max-width: 100% !important; padding: .35rem .5rem !important; white-space: nowrap !important; word-break: keep-all !important; line-height: 1.25 !important; box-sizing: border-box !important; } }
`,
  inkblot:`
/* Give the decorative Inkblot rating dots semantic text marks in a known glyph font; the preceding icon-font override renders an empty circle for these characters. */
.page-rate-widget-box .rateup a, .page-rate-widget-box .ratedown a, .page-rate-widget-box .cancel a, .creditRate .rateup a, .creditRate .ratedown a, .creditRate .cancel a { font-family: Arial, sans-serif !important; font-size: .8rem !important; font-weight: 700 !important; color: #23140b !important; -webkit-text-fill-color: #23140b !important; }
.page-rate-widget-box .rateup a::before, .creditRate .rateup a::before { content: "+" !important; font-family: Arial, sans-serif !important; color: #23140b !important; }
.page-rate-widget-box .ratedown a::before, .creditRate .ratedown a::before { content: "−" !important; font-family: Arial, sans-serif !important; color: #23140b !important; }
.page-rate-widget-box .cancel a::before, .creditRate .cancel a::before { content: "×" !important; font-family: Arial, sans-serif !important; color: #23140b !important; }
.page-rate-widget-box .cancel a::after, .creditRate .cancel a::after { content: none !important; display: none !important; }
`
};
const imageReviewRepairsV2={
  penumbra:`
/* Chromium screenshots at 390px showed the live SCP-JP site title clipping horizontally and colliding with its subtitle. Keep the Penumbra ink/logo treatment while making the actual heading rows wrap and flow on phone widths. */
@media (max-width: 767px) {
  #header { position: relative !important; display: flow-root !important; width: 100% !important; height: auto !important; min-height: 0 !important; max-width: 100vw !important; padding-block: .75rem !important; box-sizing: border-box !important; }
  #header h1, #header h2 { position: static !important; float: none !important; display: block !important; clear: both !important; width: auto !important; min-width: 0 !important; max-width: calc(100vw - 2rem) !important; height: auto !important; margin: .25rem 1rem !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; }
  #header h1 *, #header h2 * { white-space: normal !important; overflow-wrap: anywhere !important; }
  #search-top-box { position: static !important; inset: auto !important; float: none !important; clear: both !important; display: block !important; width: auto !important; max-width: calc(100vw - 2rem) !important; margin: .5rem 1rem 0 !important; box-sizing: border-box !important; }
  #search-top-box-form { position: static !important; display: flex !important; justify-content: flex-end !important; width: 100% !important; }
}
`,
  redtape:`
/* The reviewed 390px other-license modal squeezed its Japanese back link into a vertical label. Preserve the red-tape button palette and reserve one readable line for the control. */
@media (max-width: 600px) { #u-credit-otherwise .modalbox a[href="#u-credit-view"] { display: inline-flex !important; align-items: center !important; justify-content: center !important; flex: 0 0 auto !important; width: auto !important; min-width: 4rem !important; max-width: 100% !important; padding: .35rem .5rem !important; white-space: nowrap !important; word-break: keep-all !important; line-height: 1.25 !important; box-sizing: border-box !important; } }
`,
  'dear-dictator':`
/* The JP mobile action-row screenshot showed the theme's pale gold link ink disappearing on its light control surface. Darken only live reader/action links; keep the gold buttons, borders and warning strip. */
#page-content a, #page-options-bottom a, #page-options-bottom-2 a, .page-tags a { color: #705900 !important; -webkit-text-fill-color: #705900 !important; }
#page-content a:hover, #page-content a:focus, #page-options-bottom a:hover, #page-options-bottom a:focus, #page-options-bottom-2 a:hover, #page-options-bottom-2 a:focus, .page-tags a:hover, .page-tags a:focus { color: #3e3100 !important; -webkit-text-fill-color: #3e3100 !important; }
/* Keep the mobile navigation reachable after an action pane scrolls the page; the absolute theme bar otherwise moves out of the viewport with its scrolled ancestor. */
@media (max-width: 767px) { #top-bar .mobile-top-bar { position: fixed !important; top: 0 !important; right: 0 !important; bottom: auto !important; left: 0 !important; z-index: 13 !important; } }
`,
};
const sharedHeaderFlowRepair=`
/* These captured JP theme headers share the legacy zero-line-height title recipe: the anchor reserves 80px/25px and the subtitle span reserves 19px with line-height 0, so real SCP-JP title text overlaps despite its headings being in document flow. Keep the logo's inline offset and theme colors while restoring natural wrapped line boxes. */
@media (max-width: 767px) {
  #header { height: auto !important; min-height: 0 !important; }
  #header h1, #header h2 { height: auto !important; min-height: 0 !important; max-height: none !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; }
  #header h1 > a { display: block !important; width: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important; padding-top: 2.5rem !important; padding-bottom: 0 !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; }
  #header h1 > a > span { display: block !important; position: static !important; inset: auto !important; height: auto !important; min-height: 0 !important; padding: 0 !important; margin: 0 !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; }
  #header h2 > span { display: block !important; position: static !important; inset: auto !important; height: auto !important; min-height: 0 !important; padding-block: 0 !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; }
}
`;
const imageReviewRepairsV3=Object.fromEntries(['site','wikifot','classic','y2k','yossistyle','penumbra'].map(theme=>[theme,sharedHeaderFlowRepair]));
imageReviewRepairsV3.site+=`\n@media (max-width: 767px) { #top-bar a, #top-bar a:visited { color: #252525 !important; -webkit-text-fill-color: #252525 !important; } #top-bar a:hover, #top-bar a:focus-visible { color: #111 !important; } }\n`;
const mobileNavigationRepairsV1={
 'dear-dictator':`
/* The absolute mobile bar moves out of view after an inline action-pane scroll. Keep the theme navigation reachable at the viewport top while preserving its colors and controls. */
@media (max-width: 767px) { #top-bar .mobile-top-bar { position: fixed !important; inset: 0 0 auto 0 !important; z-index: 13 !important; } }
`,
 scheme:`
/* The positioned gear decoration (div#extra-div-2, z-index 20) intercepted the mobile menu touch target. Raise the responsive navigation layer above its decorative header sibling without changing the artwork. */
@media (max-width: 767px) { #top-bar { position: relative !important; z-index: 21 !important; } #top-bar .mobile-top-bar { position: relative !important; z-index: 22 !important; } #top-bar .mobile-top-bar .open-menu { position: relative !important; z-index: 23 !important; } }
`
};
const mobileNavigationRepairsV2={
 scheme:`
/* After the tap-test fix, the screenshot showed the static trigger at the top-bar's inherited top:179px position, where it overlaid the first article heading. Return the theme's mobile top bar to normal document flow so it reserves its own navigation row before the page title. */
@media (max-width: 767px) { #top-bar { position: static !important; top: auto !important; margin-block: .25rem !important; z-index: auto !important; } #top-bar .mobile-top-bar { position: relative !important; top: auto !important; z-index: 21 !important; } #top-bar .mobile-top-bar .open-menu { position: relative !important; z-index: 22 !important; } }
`
};
const mobileHeaderLogicalSizeFix=`
/* Image review plus DOM evidence: the imported stylesheet sets logical block-size:0 on heading spans, so text paints outside a zero-height flow box and the following Search/mobile navigation overlaps it. Reset the logical constraint as well as physical height. */
@media (max-width: 767px) {
  #header h1, #header h2, #header h1 > a, #header h1 > a > span, #header h2 > span { block-size: auto !important; min-block-size: 0 !important; max-block-size: none !important; }
  #header h1 > a > span, #header h2 > span { overflow: visible !important; }
  #search-top-box, #search-top-box-form, #top-bar { block-size: auto !important; min-block-size: 0 !important; }
}
`;
const imageReviewRepairsV4=Object.fromEntries(['site','wikifot','classic','y2k','yossistyle','penumbra'].map(theme=>[theme,mobileHeaderLogicalSizeFix]));
const mobileHeaderNavigationFlowFix=`
/* Follow-up to the visual defect: the same imported header positions .mobile-top-bar above the zero-height #top-bar. Return the responsive navigation list to flow after Search while its round open-menu button keeps its fixed touch target. */
@media (max-width: 767px) {
  #top-bar { display: block !important; height: auto !important; min-height: 0 !important; block-size: auto !important; }
  .mobile-top-bar { position: relative !important; inset: auto !important; display: block !important; width: 100% !important; max-width: 100% !important; height: auto !important; min-height: 0 !important; margin: .35rem 0 0 !important; block-size: auto !important; }
  .mobile-top-bar > ul { position: static !important; inset: auto !important; display: flex !important; flex-wrap: wrap !important; align-items: center !important; width: 100% !important; height: auto !important; min-height: 0 !important; margin: 0 !important; block-size: auto !important; }
}
`;
const imageReviewRepairsV5=Object.fromEntries(['site','wikifot','classic','y2k','yossistyle','penumbra'].map(theme=>[theme,mobileHeaderNavigationFlowFix]));
const imageReviewRepairsV6={
  wikifot:`
/* The fixed hamburger occupied the first title line on the fresh mobile screenshot; start the wordmark below its 42px control and retain its upper-right account text. */
@media (max-width: 767px) {
  #header h1 > a { padding-top: 3.75rem !important; }
  #login-status, #login-status * { color: #343434 !important; -webkit-text-fill-color: #343434 !important; }
}
`,
  y2k:`
/* The inherited 76px logo gutter was added to a full-width heading, clipping the SCP-JP site title at the right edge. Let both localized heading blocks consume only their remaining inline space. */
@media (max-width: 767px) { #header h1, #header h2 { width: auto !important; max-width: calc(100vw - 5rem) !important; margin-right: 0 !important; box-sizing: border-box !important; } #header h1 > a { width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; } }
`,
  yossistyle:`
/* The inherited 76px logo gutter was added to a full-width heading, clipping the SCP-JP site title at the right edge. Let both localized heading blocks consume only their remaining inline space. */
@media (max-width: 767px) { #header h1, #header h2 { width: auto !important; max-width: calc(100vw - 5rem) !important; margin-right: 0 !important; box-sizing: border-box !important; } #header h1 > a { width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; } }
`
};
const imageReviewRepairsV7={
  y2k:`
/* Y2K's original pixel emblem is centered under the localized heading and obscures the motto. Retain the emblem as a right-side masthead mark and reserve its width while keeping both text rows readable. */
@media (max-width: 767px) { #header { background-position: right .75rem top .5rem !important; background-size: auto 3.25rem !important; } #header h1, #header h2 { max-width: calc(100% - 4.5rem) !important; margin-left: 0 !important; margin-right: auto !important; } }
`,
  jakstyle:`
/* The source mobile header is sticky at a negative top offset, which clips the localized wordmark on its first settled view. Keep the theme masthead visible and let title, subtitle, search, and mobile navigation occupy their own rows. */
@media (max-width: 767px) { #header { top: 0 !important; position: relative !important; height: auto !important; min-height: 8rem !important; max-height: none !important; padding: 1.25rem .75rem .5rem !important; box-sizing: border-box !important; background-position: .5rem .5rem !important; background-size: 3.5rem auto !important; } #header h1, #header h2 { position: static !important; float: none !important; display: block !important; width: auto !important; max-width: calc(100% - 3.5rem) !important; height: auto !important; min-height: 1.25em !important; margin: .25rem 0 .25rem 3.5rem !important; padding: 0 !important; line-height: 1.3 !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; } #header h1 > a, #header h1 > a > span, #header h2 > span { position: static !important; display: block !important; width: auto !important; max-width: 100% !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; line-height: inherit !important; white-space: normal !important; overflow-wrap: anywhere !important; } #search-top-box { position: relative !important; inset: auto !important; float: none !important; width: 100% !important; max-width: 100% !important; margin: .5rem 0 0 !important; } #top-bar { position: relative !important; top: auto !important; width: 100% !important; height: auto !important; margin: .35rem 0 0 !important; } .mobile-top-bar { position: relative !important; inset: auto !important; width: 100% !important; height: auto !important; min-height: 2.5rem !important; } }
`
};
const imageReviewRepairsV8={
  skipos:`
/* The circular artwork did not respond to the suspected body wallpaper sizing rule; restore the source wallpaper geometry while the true painted element is investigated. */
@media (max-width: 767px) { body:not(#interwiki body)::before { background-size: cover !important; background-position: center !important; opacity: 1 !important; } }
`
};
const imageReviewRepairsV9={
  skipos:`
/* Restore the actual 32px SkipOS logo token; hiding this pseudo-element removed its wordmark icon but did not affect the unidentified large cyan mark. */
@media (max-width: 767px) { #header h1 a::before { content: '' !important; display: block !important; background-image: var(--header-logo) !important; background-size: 2rem !important; } }
`
};
const imageReviewRepairsV10={
  skipos:`
/* Restore only the source-size logo and wallpaper after the earlier experiments failed to affect the large cyan mark. These are confirmed source tokens and this rule must not conceal any other artwork. */
@media (max-width: 767px) { body:not(#interwiki body)::before { background-size: cover !important; background-position: center !important; opacity: 1 !important; } #header h1 a::before { content: '' !important; display: block !important; background-image: var(--header-logo) !important; background-size: 2rem !important; } }
`
};
const imageReviewRepairsV11={
  'night-rush-theme':`/* Image-reviewed SCP-JP masthead adaptation: the localized site name occupied the same 64px header band as Night Rush's Foundation emblem. Reserve the emblem's left column for both semantic title rows on phone widths, while preserving the upstream background art and typography. */\n@media (max-width: 767px) { #header h1 > a, #header h2 > span { padding-inline-start: 4.75rem !important; box-sizing: border-box !important; } }`
};
const imageReviewRepairsV12={
  'night-rush-theme':`/* Follow-up image review: the theme's legacy nested anchor and subtitle spans retained one-line heights after their text wrapped. Let the localized site title and subtitle reserve all wrapped lines before Search/navigation flows below. */\n@media (max-width: 767px) { #header h1, #header h2, #header h1 > a, #header h1 > a > span, #header h2 > span { display: block !important; height: max-content !important; min-height: max-content !important; max-height: none !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; } }`
};
const imageReviewRepairsV13={
  'aesthetic-theme':`/* Image-reviewed mobile contrast repair: the generated wordmark fill used Aesthetic's very dark gradient stops on its saturated magenta header, making the theme name hard to read. Keep the magenta/cyan identity and emblem while giving only the wordmark a pale cyan fill and dark outline. */\n@media (max-width: 767px) { #header h1 a::after { color: #c8ffff !important; -webkit-text-fill-color: #c8ffff !important; background: none !important; -webkit-background-clip: border-box !important; -webkit-text-stroke: .1rem #19002f !important; } }`,
  'al-slop':`/* Image-reviewed narrow-header repair: the absolute collage masthead lets the logged-in account chip cover the localized site-name line. Keep the meme collage and account control, but anchor that control in the masthead's free upper-right corner at the SCP-JP 320px boundary. */\n@media (max-width: 400px) { #header { position: relative !important; } #login-status { position: absolute !important; top: .35rem !important; right: .4rem !important; z-index: 20 !important; margin: 0 !important; max-width: calc(100vw - 2rem) !important; } }`
};
const imageReviewRepairsV14={
  'aesthetic-theme':`/* Follow-up image review: the upstream BHL title uses two stacked pseudo-elements; recoloring only ::after left the dark ::before glyph fill visible on the magenta masthead. Apply the same high-contrast fill to both layers while retaining a dark outline and the original emblem/background. */\n@media (max-width: 767px) { #header h1 a::before, #header h1 a::after { color: #c8ffff !important; -webkit-text-fill-color: #c8ffff !important; background: none !important; -webkit-background-clip: border-box !important; -webkit-text-stroke: .1rem #19002f !important; } }`,
  monotypical:`/* Image-reviewed 320px repair: Monotypical's visible Foundation wordmark is a generated h1 anchor pseudo-element; prevent the fallback overflow-wrap:anywhere from splitting the final letters. */\n@media (max-width: 360px) { #header h1 a::before { white-space: normal !important; overflow-wrap: normal !important; word-break: normal !important; hyphens: none !important; font-size: clamp(1rem, 6.5vw, 1.25rem) !important; letter-spacing: -.035em !important; } }`
};
const imageReviewRepairsV15={
  foxtrot:`/* Image-reviewed tabview repair: Foxtrot's dark-plum page inherited a white YUI tab panel with pale text, washing out the tab content. Keep its native plum surface and readable light copy inside the existing panel. */\n#page-content .yui-navset .yui-content { background-color: #190d1c !important; color: #f2eaf4 !important; border-color: #a778b2 !important; }\n#page-content .yui-navset .yui-content a { color: #f0d9ff !important; }\n#page-content .yui-navset .yui-content a:hover, #page-content .yui-navset .yui-content a:focus-visible { color: #fff !important; background-color: #4a174e !important; }`
};
const imageReviewRepairsV16={
  foxtrot:`/* Direct image + computed-style finding: the light surface was #toc inside the YUI tab's folded content, not the tab panel. Match the TOC to Foxtrot's dark-plum body and retain a readable lilac border/link treatment. */\n#page-content #toc { color: #f2eaf4 !important; background-color: #190d1c !important; border: 1px solid #a778b2 !important; }\n#page-content #toc a { color: #f0d9ff !important; }\n#page-content #toc a:hover, #page-content #toc a:focus-visible { color: #fff !important; background-color: #4a174e !important; }`
};
const imageReviewRepairsV17={
  space:`/* Direct desktop screenshot finding: the SCP-JP localized Space title and subtitle line boxes touch in the inherited header, and the top bar starts too soon after the subtitle. Give these current runtime rows separate space while retaining the starfield, font and accent palette. */\n@media (min-width: 601px) { #header { min-height: 180px !important; } #header h2 { margin-top: 1rem !important; } #top-bar { top: 160px !important; } }`
};
const imageReviewRepairsV18={
  'al-slop':`/* Direct image + overlap diagnostics: SCP-JP's Local Translation Corpus masthead title descends to y232 while #page-title begins at y198. Reserve the full masthead title band in desktop flow; preserve the collage and both labels instead of hiding either one. */\n@media (min-width: 768px) { #header { min-height: 15.5rem !important; } }`
};
const imageReviewRepairsV19={
  'al-slop':`/* Direct after-image review: the localized SCP-JP label is white over pale collage panels at the masthead's upper-right edge. Keep its white type and poster contrast, adding the theme's charcoal outline for legibility across variable imagery. */\n@media (min-width: 768px) { #header h2, #header h2 > span { color: #fff5f3 !important; -webkit-text-fill-color: #fff5f3 !important; text-shadow: 0 1px 3px #221f1e, 1px 0 2px #221f1e, -1px 0 2px #221f1e !important; } }`
};
const imageReviewRepairsV20={
  'al-slop':`/* DOM review identified the white localized navigation as #top-bar links on pale image panels, not the masthead subtitle. Preserve the poster nav and make white labels readable over light collage areas with the same charcoal outline. */\n@media (min-width: 768px) { #top-bar .top-bar a { text-shadow: 0 1px 3px #221f1e, 1px 0 2px #221f1e, -1px 0 2px #221f1e !important; } }`
};
const imageReviewRepairsV21={
  yossistyle:`
/* Direct image review: the logged-in account name inherits an almost-white theme token on the white localized masthead. Keep the native header background and restore legible account ink. */
#login-status, #login-status a, #login-status .printuser, #login-status .printuser a { color: #343434 !important; -webkit-text-fill-color: #343434 !important; text-shadow: none !important; }
`,
  jakstyle:`
/* Direct mobile image review: dark Japanese tab content is rendered on Jakstyle's deep burgundy YUI tab panel. Keep the panel identity and use its light text palette for content and links. */
#page-content .yui-navset .yui-content, #page-content .yui-navset .yui-content * { color: #fff0f2 !important; -webkit-text-fill-color: #fff0f2 !important; }
#page-content .yui-navset .yui-content a { text-decoration: underline !important; text-underline-offset: .14em; }
`,
  'ouroborous-theme':`
/* Direct mobile image review: Ouroborous' active red tab keeps the browser-default black label, which disappears against the saturated fill. Preserve the red tab and use the theme's high-contrast light ink. */
#page-content .yui-navset .yui-nav a, #page-content .yui-navset .yui-nav a em { color: #fff0f0 !important; -webkit-text-fill-color: #fff0f0 !important; }
#page-content .yui-navset .yui-nav a:hover, #page-content .yui-navset .yui-nav a:focus-visible, #page-content .yui-navset .yui-nav a:hover em, #page-content .yui-navset .yui-nav a:focus-visible em { color: #fff !important; -webkit-text-fill-color: #fff !important; }
`,
};
const imageReviewRepairsV22={
  y2k:`
/* Image review: the pixel emblem on the right shares the same top band as the logged-in SCP-JP account links. Reserve a clear account lane between the mobile menu and emblem; keep the art and account controls visible. */
@media (max-width: 767px) { #login-status { top: .35rem !important; right: 5rem !important; max-width: calc(100vw - 10rem) !important; white-space: normal !important; line-height: 1.2 !important; text-align: right !important; } }
`,
  jakstyle:`
/* Image review at the 320px credit modal: the Rate widget's inherited dark labels are almost invisible on the crimson strip. Keep Jakstyle's red credit surface and use the existing pale masthead ink for the actual controls. */
.creditRate .page-rate-widget-box, .creditRate .page-rate-widget-box *, #u-credit-view .creditRate, #u-credit-view .creditRate *, #u-credit-otherwise .creditRate, #u-credit-otherwise .creditRate * { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }
`,
  'isolated-terminal':`
/* Cross-engine mobile image review: the long Japanese collapsible label wraps into the following sidebar heading. Give each live sidebar row an intrinsic block size and explicit separation while preserving the terminal palette. */
@media (max-width: 767px) {
 #side-bar .side-block .collapsible-block, #side-bar .side-block .collapsible-block-unfolded { display: flow-root !important; height: auto !important; min-height: 0 !important; }
 #side-bar .side-block .collapsible-block-link, #side-bar .side-block .collapsible-block-unfolded-link { display: block !important; position: relative !important; height: auto !important; min-height: 2rem !important; margin-block: .45rem .75rem !important; padding-block: .4rem !important; line-height: 1.45 !important; white-space: normal !important; overflow-wrap: anywhere !important; }
 #side-bar .side-block .heading { display: flow-root !important; clear: both !important; height: auto !important; min-height: 1.5em !important; margin-block: .85rem .45rem !important; line-height: 1.4 !important; }
}
`
};
const imageReviewRepairsV23={
  basalt:`
/* Image review at 320px: the localized subtitle is painted underneath fixed search/account controls. Keep the basalt masthead artwork while placing both semantic labels and controls into separate natural rows at policy widths. */
@media (max-width: 400px) { #header { height: auto !important; min-height: 0 !important; padding-block: .75rem !important; } #header h1, #header h2 { position: static !important; display: block !important; float: none !important; width: 100% !important; max-width: 100% !important; height: auto !important; min-height: 0 !important; margin: .25rem 0 !important; line-height: 1.3 !important; white-space: normal !important; overflow-wrap: anywhere !important; } #search-top-box, #login-status { position: static !important; inset: auto !important; float: none !important; clear: both !important; margin: .4rem 0 0 auto !important; } #top-bar { position: relative !important; inset: auto !important; width: 100% !important; margin-top: .35rem !important; } }
/* Basalt's mobile dropdown is a navigation panel, so keep its native charcoal surface opaque over the masthead and article. */
@media (max-width: 900px) { .mobile-top-bar ul, .mobile-top-bar > ul ul { background-color: #262626 !important; } }
`,
  bedrock:`
/* Bedrock's expanded mobile menu inherited a transparent item list; provide an opaque slate menu surface while retaining its pale-blue edge and type identity. */
@media (max-width: 900px) { .mobile-top-bar ul, .mobile-top-bar > ul ul { background-color: #263744 !important; } }
`,
  space:`
/* Tablet screenshot: the localized title and subtitle share a compressed masthead band. Let the header's identity rows take their natural height before the starfield navigation begins. */
@media (min-width: 601px) and (max-width: 900px) { #header { position: relative !important; height: auto !important; min-height: 12rem !important; padding-block: 1rem !important; box-sizing: border-box !important; } #header h1, #header h2 { position: relative !important; float: none !important; display: block !important; height: auto !important; min-height: 1.4em !important; margin-block: .55rem !important; line-height: 1.35 !important; white-space: normal !important; overflow-wrap: anywhere !important; } }
`,
  'night-rush-theme':`
/* Tablet screenshot: the Foundation header mark, localized title and subtitle occupy the same fixed row. Restore masthead flow at this breakpoint without removing its starfield identity. */
@media (min-width: 601px) and (max-width: 900px) { #header { position: relative !important; height: auto !important; min-height: 12rem !important; padding-block: 1rem !important; box-sizing: border-box !important; } #header h1, #header h2 { position: relative !important; float: none !important; display: block !important; height: auto !important; min-height: 1.4em !important; margin-block: .55rem !important; line-height: 1.35 !important; white-space: normal !important; overflow-wrap: anywhere !important; } }
`,
  skipos:`
/* Image review found the Source and revision-diff headings nearly disappear on SkipOS's light diagonal panel. Preserve the geometry and make only those action-pane labels use the theme's dark-ink token. */
#action-area > h1, #action-area > h2, #action-area .page-source-header, #action-area .revision-diff-title { color: #f4f5ff !important; -webkit-text-fill-color: #f4f5ff !important; text-shadow: 0 1px 2px #10131d !important; }
`,
  yossistyle:`
/* The reviewed account label remained faint after the first color change. Use the theme's dark masthead ink, full opacity and normal weight for account/navigation text only. */
#login-status, #login-status a, #login-status .printuser, #login-status .printuser a { color: #161616 !important; -webkit-text-fill-color: #161616 !important; opacity: 1 !important; font-weight: 600 !important; text-shadow: none !important; }
#login-status .printuser { display: none !important; }
`,
  jakstyle:`
/* The real credit modal Rate box is a sibling beneath #u-credit-view, not a descendant of the article's .creditRate wrapper. Match the rendered module and its interactive descendants while retaining the burgundy strip. */
#u-credit-view .page-rate-widget-box, #u-credit-view .page-rate-widget-box *, #u-credit-view .rate-box-with-credit-button, #u-credit-view .rate-box-with-credit-button * { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }
/* Keep the narrow Japanese back affordance as one touch-sized label. */
#u-credit-otherwise .credit-back { display: block !important; position: static !important; height: auto !important; margin: .5rem auto !important; }
#u-credit-otherwise .credit-back a[href="#u-credit-view"] { display: inline-flex !important; width: max-content !important; min-width: 4.5rem !important; max-width: 100% !important; min-height: 2.25rem !important; white-space: nowrap !important; word-break: keep-all !important; overflow-wrap: normal !important; align-items: center !important; justify-content: center !important; }
`,
  'ouroborous-theme':`
/* The tab text is painted by nested YUI list/label layers; make every visible label layer inherit the pale identity ink against the active red strip. */
#page-content .yui-navset .yui-nav li a, #page-content .yui-navset .yui-nav li a *, #page-content .yui-navset .yui-nav li a::before, #page-content .yui-navset .yui-nav li a::after { color: #fff0f0 !important; -webkit-text-fill-color: #fff0f0 !important; }
#page-content .yui-navset .yui-nav li a:hover, #page-content .yui-navset .yui-nav li a:focus-visible, #page-content .yui-navset .yui-nav li a:hover *, #page-content .yui-navset .yui-nav li a:focus-visible * { color: #fff !important; -webkit-text-fill-color: #fff !important; }
`,
  inkblot:`
/* The frozen back link lives inside .credit-back, which SCP-JP's shared credit style hides for credit:view but theme CSS also suppresses in otherwise mode. Re-expose the existing parent and link only in the other-license dialog. */
#u-credit-otherwise .modalbox .credit-back { display: block !important; visibility: visible !important; height: auto !important; min-height: 2.25rem !important; position: static !important; float: none !important; margin: .65rem auto !important; }
#u-credit-otherwise .credit-back a[href="#u-credit-view"] { display: inline-flex !important; position: static !important; float: none !important; min-width: 4.5rem !important; min-height: 2.25rem !important; white-space: nowrap !important; align-items: center !important; justify-content: center !important; }
`,
  'much-cool':`
/* WebKit mobile Source screenshot: the fixed hamburger overlays the first letter of the action-pane heading. Reserve its left touch-control lane on action panes while retaining Much Cool's display face. */
@media (max-width: 767px) { #action-area > h1, #action-area > h2 { padding-inline-start: 3rem !important; box-sizing: border-box !important; } }
`,
  'flopstyle-dark':`
/* At SCP-JP's 320px boundary the compact credit view uses a static inherited offset, placing its modal below the viewport. Center the actual credit dialog in the viewport and keep its own content scrollable. */
@media (max-width: 400px) { #u-credit-view:target { position: fixed !important; inset: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; } #u-credit-view:target .modalcontainer { position: static !important; inset: auto !important; width: calc(100vw - 1rem) !important; max-width: calc(100vw - 1rem) !important; max-height: calc(100dvh - 1rem) !important; } #u-credit-view:target .modalbox { max-width: 100% !important; max-height: calc(100dvh - 1rem) !important; overflow: auto !important; box-sizing: border-box !important; } }
`,
  foxtrot:`
/* At 320px Foxtrot's fixed credit-view panel is offset below the viewport, and its file rows exceed the phone width. Center only the JP credit modal; let the established file-list scroller expose full metadata/actions without clipping filenames. */
@media (max-width: 400px) { #u-credit-view:target { position: fixed !important; inset: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; } #u-credit-view:target .modalcontainer { position: static !important; inset: auto !important; width: calc(100vw - 1rem) !important; max-width: calc(100vw - 1rem) !important; max-height: calc(100dvh - 1rem) !important; } #u-credit-view:target .modalbox { max-width: 100% !important; max-height: calc(100dvh - 1rem) !important; overflow: auto !important; box-sizing: border-box !important; } #action-area .file-list-scroll { max-width: calc(100vw - 2rem) !important; overflow-x: auto !important; } #action-area .file-list { min-width: 32rem !important; } }
`,
};
const imageReviewRepairsV24={
  'minimalist-bhl':`
/* The live tab and footnote panels inherited burgundy ink over burgundy backgrounds. Preserve the minimalist BHL surfaces and restore its light reading ink. */
#page-content .yui-navset .yui-nav a em, #page-content .yui-navset .yui-nav .selected a em { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }
#page-content .yui-navset .yui-content, #page-content .yui-navset .yui-content *, #page-content .collapsible-block-unfolded, #page-content .collapsible-block-unfolded *, #page-content .footnote, #page-content .footnote * { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }
#page-content .yui-navset .yui-content a, #page-content .collapsible-block-unfolded a, #page-content .footnote a { text-decoration: underline !important; text-underline-offset: .14em; }
`,
  'ouroborous-theme':`
/* The theme styles wiki table headings and credit modal headings with black ink on saturated red. Keep the red motif and use the established pale theme text. */
#page-content table.wiki-content-table th, #page-content table.wiki-content-table th *, #page-content table.wiki-content-table th::before, #page-content table.wiki-content-table th::after { color: #fff0f0 !important; -webkit-text-fill-color: #fff0f0 !important; }
#u-credit-view .modalbox .modalbox-title, #u-credit-view .modalbox .modalbox-title *, #u-credit-view .modalbox .modalbox-title::before, #u-credit-view .modalbox .modalbox-title::after { color: #fff0f0 !important; -webkit-text-fill-color: #fff0f0 !important; }
`,
  'aesthetic-theme':`
/* The lime sidebar highlight is a deliberate theme accent, but its pink submenu label is hard to read. Use the existing deep-plum ink on this control only. */
#side-bar .collapsible-block-link, #side-bar .collapsible-block-unfolded-link .collapsible-block-link { color: #160c2d !important; -webkit-text-fill-color: #160c2d !important; text-shadow: none !important; }
`
};
const imageReviewRepairsV25={
  'minimalist-bhl':`
/* The live FTML renderer names its visible footnote panel .footnotes-footer/.footnote-footer, not .footnote. Apply the same BHL light reading ink to the actual rendered Japanese note body. */
#page-content .footnotes-footer, #page-content .footnotes-footer *, #page-content .footnote-footer, #page-content .footnote-footer *, #page-content .footnote .f-content, #page-content .footnote .f-content * { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }
`
};
const imageReviewRepairsV26={
  'minimalist-bhl':`
/* The opened disclosure body is a light panel in the current JP runtime; keep the original light surface and use the deep-red BHL ink instead of the pale tab-panel ink. */
#page-content .collapsible-block-unfolded, #page-content .collapsible-block-unfolded * { color: #64030f !important; -webkit-text-fill-color: #64030f !important; }
#page-content .collapsible-block-unfolded a { color: #900 !important; -webkit-text-fill-color: #900 !important; text-decoration: underline !important; }
`
};
const imageReviewRepairsV27={
  'minimalist-bhl':`
/* The expanded disclosure's close affordance sits on the crimson header, outside the body selector. Keep the header and raise this action label to the same pale ink. */
#page-content .collapsible-block-unfolded-link .collapsible-block-link, #page-content .collapsible-block-unfolded-link .collapsible-block-link:hover, #page-content .collapsible-block-unfolded-link .collapsible-block-link:focus-visible { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }
`
};
const imageReviewRepairsV28={
  'ouroborous-theme':`
/* The otherwise-credit modal back control inherited a narrow theme action width, wrapping the Japanese label vertically. Keep its red modal styling and provide a content-sized, non-wrapping target at every viewport. */
#u-credit-otherwise .modalbox .credit-back, #u-credit-otherwise .modalbox .credit-back a[href="#u-credit-view"] { display: inline-flex !important; align-items: center !important; justify-content: center !important; width: auto !important; min-width: 4.5rem !important; max-width: 100% !important; padding: .35rem .6rem !important; white-space: nowrap !important; word-break: keep-all !important; overflow-wrap: normal !important; box-sizing: border-box !important; }
`
};
const imageReviewRepairsV29={
  'aesthetic-theme':`
/* Image review found the expanded article disclosure retained aqua ink on Aesthetic's fluorescent lime panel. Keep the neon surface and use the established deep-plum ink only inside the open content; links stay underlined. */
#page-content .collapsible-block-unfolded .collapsible-block-content, #page-content .collapsible-block-unfolded .collapsible-block-content * { color: #160c2d !important; -webkit-text-fill-color: #160c2d !important; text-shadow: none !important; }
#page-content .collapsible-block-unfolded .collapsible-block-content a { text-decoration: underline !important; text-underline-offset: .14em; }
`
};
const imageReviewRepairsV30={
  'aesthetic-theme':`
/* Follow-up image review found the fluorescent yellow surface belongs to the TOC links, while the opened disclosure body uses Aesthetic's dark panel. Restore the light body ink and darken only links on the yellow TOC surface. */
#page-content .collapsible-block-unfolded .collapsible-block-content, #page-content .collapsible-block-unfolded .collapsible-block-content * { color: #d9e9fb !important; -webkit-text-fill-color: #d9e9fb !important; text-shadow: none !important; }
#page-content #toc-list a { color: #160c2d !important; -webkit-text-fill-color: #160c2d !important; text-shadow: none !important; }
`
};
const imageReviewRepairsV31={
  bedrock:`
/* The inherited Basalt base reset SCP-JP's fixed credit dialog container to normal flow, leaving the mobile modal at the top-left. Center both real credit-dialog states in the viewport while retaining the theme's own panel and fader colors. */
@media (max-width: 767px) {
 #u-credit-view:target .modalcontainer, #u-credit-otherwise:target .modalcontainer { position: absolute !important; inset: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; max-width: none !important; margin: 0 !important; box-sizing: border-box !important; }
 #u-credit-view:target .modalbox, #u-credit-otherwise:target .modalbox { width: min(37.5rem, calc(100vw - 1rem)) !important; min-width: 0 !important; max-width: calc(100vw - 1rem) !important; height: min(50svh, calc(100dvh - 1rem)) !important; max-height: calc(100dvh - 1rem) !important; margin: 0 !important; box-sizing: border-box !important; }
}
`,
  basalt:`
/* The inherited Basalt base reset SCP-JP's fixed credit dialog container to normal flow, leaving the mobile modal at the top-left. Center both real credit-dialog states in the viewport while retaining the theme's own panel and fader colors. */
@media (max-width: 767px) {
 #u-credit-view:target .modalcontainer, #u-credit-otherwise:target .modalcontainer { position: absolute !important; inset: 0 !important; display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; max-width: none !important; margin: 0 !important; box-sizing: border-box !important; }
 #u-credit-view:target .modalbox, #u-credit-otherwise:target .modalbox { width: min(37.5rem, calc(100vw - 1rem)) !important; min-width: 0 !important; max-width: calc(100vw - 1rem) !important; height: min(50svh, calc(100dvh - 1rem)) !important; max-height: calc(100dvh - 1rem) !important; margin: 0 !important; box-sizing: border-box !important; }
}
`
};
const imageReviewRepairsV32={
  'minimalist-bhl':`
/* Image review found the previous light-on-crimson action rule also reached the live Files pane's white filename surface. Restore dark link ink on file rows and give the crimson upload/restore controls the same light label used by BHL tabs. */
#action-area .file-list .file-row .file-name a, #action-area .file-list .file-row .file-name a:visited { color: #64030f !important; -webkit-text-fill-color: #64030f !important; text-decoration: underline !important; }
#action-area .file-action .action-button, #action-area .file-action .action-button:hover, #action-area .file-action .action-button:focus-visible { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }
`
};
const imageReviewRepairsV33={
  'aesthetic-theme':`
/* The mobile theme header is a higher stacking context than SCP-JP's credit layer, so its hamburger crossed the fader and hid the otherwise-modal title. Drop only the header stack below the visible credit dialog while a credit hash is active. */
body:has(#u-credit-view:target) #header, body:has(#u-credit-otherwise:target) #header { z-index: 9 !important; }
`,
  inkblot:`
/* Image review found the transparent footer's inherited tertiary gray made the runtime attribution almost disappear on white. Keep the transparent paper surface and use its existing dark body ink for the text. */
#footer { color: #333 !important; }
`,
  'minimalist-bhl':`
/* Wikidot file management renders Upload/Restore as legacy .buttons inputs rather than the local .file-action buttons. Preserve the crimson controls and use BHL's light menu ink on their labels. */
#action-area .buttons input[type="button"], #action-area .buttons input[type="button"]:hover, #action-area .buttons input[type="button"]:focus-visible { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }
`
};
const imageReviewRepairsV34={
  'aesthetic-theme':`
/* V33 lowering z-index alone did not form a stacking context because the theme leaves #header unpositioned. During either SCP-JP credit hash, isolate the in-flow header below the shared modal/fader so its high-z hamburger cannot cross the overlay. */
body:has(#u-credit-view:target) #header, body:has(#u-credit-otherwise:target) #header { position: relative !important; isolation: isolate !important; z-index: 9 !important; }
`
};
const imageReviewRepairsV35={
  'aesthetic-theme':`
/* At 320px the otherwise-license modal's one-rem container inset left an undimmed strip of the page above the fader. Extend the real hash-target overlay to the viewport edge while keeping the modal's own bounded scroll area. */
@media (max-width: 600px) { #u-credit-otherwise:target .modalcontainer { top: 0 !important; bottom: 0 !important; height: 100dvh !important; max-height: 100dvh !important; } }
`,
  basalt:`
/* At SCP-JP's 320px boundary, the imported Basalt masthead subtitle ran beneath the search/account controls. Keep the identity text, wrap it into the available title column, and leave the controls in their authored row. */
@media (max-width: 340px) { #header h2 { width: 9rem !important; max-width: 9rem !important; white-space: normal !important; overflow-wrap: anywhere !important; line-height: 1.1 !important; } }
`,
  'minimalist-bhl':`
/* The narrow Files screenshot showed the long localized filename escaping its first grid cell. Keep the real scroller, but let this cell's link wrap inside its assigned track. */
@media (max-width: 400px) { #action-area .file-list .file-row .file-name, #action-area .file-list .file-row .file-name a { min-width: 0 !important; max-width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; word-break: break-all !important; } }
/* The 320px credit.otherwise back label had one Japanese character per line. Keep the paired credit/back controls on one reachable row. */
@media (max-width: 400px) { #u-credit-otherwise .modalbox .credit-back { display: flex !important; flex-wrap: nowrap !important; justify-content: center !important; align-items: center !important; gap: .35rem !important; } #u-credit-otherwise .modalbox .credit-back a[href="#u-credit-view"] { display: inline-flex !important; width: auto !important; min-width: 3rem !important; white-space: nowrap !important; word-break: keep-all !important; overflow-wrap: normal !important; } }
`,
  hansarp:`
/* The 320px credit.otherwise back label had one Japanese character per line. Keep the paired credit/back controls on one reachable row. */
@media (max-width: 400px) { #u-credit-otherwise .modalbox .credit-back { display: flex !important; flex-wrap: nowrap !important; justify-content: center !important; align-items: center !important; gap: .35rem !important; } #u-credit-otherwise .modalbox .credit-back a[href="#u-credit-view"] { display: inline-flex !important; width: auto !important; min-width: 3rem !important; white-space: nowrap !important; word-break: keep-all !important; overflow-wrap: normal !important; } }
`
};
const imageReviewRepairsV36={
  space:`
/* Vision review: the current SCP-JP heritage credit fixture gives .modalbox.heritage a pale paper card, while Space's inherited modal text token is near-white. Keep the heritage card/title/rating design and use readable Space-night ink only for its pale-card credit copy and links. */
#u-credit-view .modalbox.heritage > .credit, #u-credit-view .modalbox.heritage > .credit *, #u-credit-otherwise .modalbox.heritage > .credit, #u-credit-otherwise .modalbox.heritage > .credit * { color: #242338 !important; -webkit-text-fill-color: #242338 !important; text-shadow: none !important; }
#u-credit-view .modalbox.heritage > .credit a, #u-credit-otherwise .modalbox.heritage > .credit a { color: #34318a !important; -webkit-text-fill-color: #34318a !important; text-decoration: underline !important; text-underline-offset: .12em; }
`,
  scpedia:`
/* Vision review at 768px: SCPedia's legacy 100px header ends while its 192px Foundation artwork and masthead text are still visible, so the current page title paints over the masthead. Reserve the authored masthead height at tablet widths and keep its identity artwork intact. */
@media (min-width: 768px) and (max-width: 979px) { div#header { height: 205px !important; min-height: 205px !important; } }
`
};
const imageReviewRepairsV37={
  space:`
/* Follow-up vision review: the Space tablet headings remained overlapped because the inherited display anchor and subtitle span still carried zero-line-height/max-height and masthead padding after their grid items were put in flow. Reset the actual text boxes at this breakpoint; keep the logo art, fonts and accent colors. */
@media (min-width: 768px) and (max-width: 900px) {
 #header { grid-template-rows: auto auto auto auto 1fr auto !important; }
 #header h1, #header h2 { min-height: 0 !important; max-height: none !important; margin-block: .6rem !important; padding: 0 !important; line-height: 1.25 !important; }
 #header h1 > a, #header h1 > a > span { display: block !important; position: static !important; inset: auto !important; width: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; }
 #header h2 > span { display: block !important; position: static !important; inset: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; line-height: 1.25 !important; white-space: normal !important; overflow-wrap: anywhere !important; }
 #top-bar { top: 225px !important; }
}
`
};
const imageReviewRepairsV38={
  space:`
/* Follow-up image review: the title and subtitle no longer collide, but the imported top bar still touches the subtitle at 768px. Move only the native navigation rail below both readable identity rows. */
@media (min-width: 768px) and (max-width: 900px) { #top-bar { top: 225px !important; } }
`,
  scpedia:`
/* Narrow-mobile visual review: long page-tag and attachment names forced the viewport sideways before opening Files/History, clipping their first/last characters. Let those existing labels wrap inside the real JP content column, and let the History card grid shrink to that column without clipping or hiding overflow. */
@media (max-width: 400px) {
 #main-content .page-tags { width: 100% !important; min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; align-items: flex-start !important; }
 #main-content .page-tags span { flex: 1 1 0 !important; width: 0 !important; min-width: 0 !important; max-width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; word-break: break-word !important; }
 #action-area .file-list, #action-area .file-list .file-row, #action-area .file-list .file-name, #action-area .file-list .file-name a { min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; white-space: normal !important; overflow-wrap: anywhere !important; word-break: break-word !important; }
 #action-area .revision-list, #action-area .revision-list .page-history { width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin-inline: 0 !important; padding-inline: 0 !important; box-sizing: border-box !important; }
}
`
};
const imageReviewRepairsV39={
  scpedia:`
/* Follow-up 320px image review: the page-tags markup's label is an anonymous flex text item, so flex min-content width defeated span wrapping. Render it as ordinary flowing text; constrain only the real Files scroller (retaining its intentional wide table) and reset inherited History-card intrinsic widths so the browser does not horizontally pan the whole page. */
@media (max-width: 400px) {
 #main-content .page-tags { display: block !important; width: 100% !important; min-width: 0 !important; max-width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; }
 #main-content .page-tags::before { display: inline-flex !important; vertical-align: top !important; }
 #action-area .file-list-scroll { display: block !important; width: 100% !important; min-width: 0 !important; max-width: 100% !important; overflow-x: auto !important; box-sizing: border-box !important; }
 #action-area .file-list { width: max(100%, 68rem) !important; max-width: none !important; }
 #action-area .file-list .file-name, #action-area .file-list .file-name a { max-width: 16rem !important; white-space: normal !important; overflow-wrap: anywhere !important; word-break: break-word !important; }
 #action-area .revision-list, #action-area .revision-list .page-history, #action-area .revision-list .page-history tbody, #action-area .revision-list .page-history tr.revision-row { width: 100% !important; min-width: 0 !important; max-width: 100% !important; margin-inline: 0 !important; box-sizing: border-box !important; }
 #action-area .revision-list .page-history { table-layout: fixed !important; }
 #action-area .revision-list .page-history .revision-attribute { min-width: 0 !important; max-width: 100% !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; }
}
`
};
const imageReviewRepairsV40={
 scpedia:`/* The 768px screenshot showed the Foundation crest ending across the first letters of the centered wordmark. Align only the existing masthead artwork to the tablet container's left edge; preserve its size, centered title/subtitle, and 205px masthead reservation. */\n@media (min-width: 768px) and (max-width: 979px) { div#extra-div-1 { background-position: 0 50% !important; } }`
};
const imageReviewRepairsV41={
 scheme:`/* Current mobile submenu screenshot showed the longest Japanese navigation label clipped at the viewport edge. Keep the gear artwork and menu colors; anchor the opened list to the right edge with a viewport-bounded width and allow labels to wrap. */\n@media (max-width: 767px) { .mobile-top-bar > ul { position: absolute !important; inset: auto 0 auto auto !important; width: min(20rem, calc(100vw - 2rem)) !important; max-width: calc(100vw - 2rem) !important; min-width: 0 !important; box-sizing: border-box !important; } .mobile-top-bar > ul a { white-space: normal !important; overflow-wrap: anywhere !important; word-break: normal !important; line-height: 1.35 !important; } }`,
 'scp-offices-theme':`/* Direct Files and policy-surface image review: the theme's pale mint foreground disappears on its cream/pale-gray panels. Keep the office palette and panel fills, but use its established deep green ink for links on these light reading/control surfaces. */\n#page-content a, #page-content a:visited, #interwiki a, #side-bar a, #action-area .file-attribute, #action-area .file-attribute a, #action-area .file-name, #action-area .file-name a, #page-options-bottom a, #page-options-bottom-2 a { color: #23443b !important; -webkit-text-fill-color: #23443b !important; }\n#page-content a, #interwiki a, #side-bar a, #action-area .file-name a { text-decoration: underline !important; text-underline-offset: .12em; }`,
 jakstyle:`/* Direct mobile screenshots show the selected Backlinks control and pane heading dark on burgundy. Preserve the burgundy action treatment and restore the theme's light foreground only on the selected action and matching pane heading. */\n#backlinks-button, #backlinks-button:hover, #backlinks-button:focus, #backlinks-button:active, #action-area .page-backlinks-header { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }`
};
const imageReviewRepairsV42={
 scheme:`/* Re-review showed the right-anchored submenu still covered the article title. Keep the expanded mobile links in normal flow so they wrap within the nav row and push article content down. */\n@media (max-width: 767px) { .mobile-top-bar > ul { position: static !important; inset: auto !important; display: block !important; width: 100% !important; max-width: 100% !important; min-width: 0 !important; margin: .25rem 0 0 !important; box-sizing: border-box !important; } .mobile-top-bar > ul a { display: block !important; max-width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; word-break: normal !important; line-height: 1.35 !important; box-sizing: border-box !important; } }`,
 jakstyle:`/* Full-resolution review of expanded actions found dark labels on burgundy buttons; a focused editor diagnostic also showed the populated source and background both computed to rgb(252,252,252). Retain the red controls and dark editor surface with readable theme-palette foregrounds. */\n#page-options-bottom #more-options-button, #page-options-bottom-2 #backlinks-button, #page-options-bottom-2 #delete-button { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }\n#action-area .page-backlinks-header { color: #850005 !important; -webkit-text-fill-color: #850005 !important; }\n#action-area textarea.editor-wikitext { color: #231316 !important; -webkit-text-fill-color: #231316 !important; background-color: #fff !important; caret-color: #850005 !important; }`
};
const imageReviewRepairsV43={
 scheme:`/* The 390px and 320px after-images confirmed the list wrapped but the topbar retained a fixed-height box, leaving its open menu over the page heading. Let the actual expanded list contribute its intrinsic height in normal flow. */\n@media (max-width: 767px) { .mobile-top-bar { display: block !important; height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; } .mobile-top-bar .open-menu { display: block !important; width: 100% !important; height: auto !important; min-height: 2.75rem !important; } .mobile-top-bar > ul { height: auto !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; } }`,
 jakstyle:`/* The regenerated More Options image still showed Delete ink against the burgundy action fill. Match this one destructive pane entry's label to the other readable light action controls. */\n#delete-button, #delete-button:hover, #delete-button:focus, #delete-button:active { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }`
};
const imageReviewRepairsV44={
 scheme:`/* Browser diagnostics showed the outer nav row was static but its nested expanded submenu remained a positioned child, so the article title still painted behind it. Put only the open nested list back in flow and let long localized labels wrap. */\n@media (max-width: 767px) { .mobile-top-bar > ul { float: none !important; clear: both !important; } .mobile-top-bar > ul > li { float: none !important; display: block !important; width: 100% !important; } .mobile-top-bar > ul > li > ul { position: static !important; inset: auto !important; float: none !important; display: block !important; width: 100% !important; min-width: 0 !important; max-width: 100% !important; height: auto !important; max-height: none !important; margin: .25rem 0 !important; overflow: visible !important; box-sizing: border-box !important; } .mobile-top-bar > ul > li > ul a { display: block !important; max-width: 100% !important; white-space: normal !important; overflow-wrap: anywhere !important; } }`
};
const imageReviewRepairsV45={
  scheme:`/* Measured runtime geometry shows the floated mobile navigation is 231px tall while its #top-bar parent collapses to 21px. Make the actual parent establish a formatting context so the localized, expanded submenu reserves its full height before the article. */\n@media (max-width: 767px) { #top-bar { display: flow-root !important; width: 100% !important; height: auto !important; min-height: 0 !important; overflow: visible !important; } #top-bar .mobile-top-bar { float: none !important; } }`
};
const imageReviewRepairsV46={
  inkblot:`/* Full-resolution post-shell review: Inkblot keeps #top-bar absolutely positioned while its imported mobile menu button is returned to flow. Reserve that menu row in the theme header so it cannot paint over the localized page title, preserving the collage and centered identity. */\n@media (max-width: 767px) { #header { position: relative !important; height: auto !important; min-height: 0 !important; } #top-bar { position: relative !important; inset: auto !important; display: flow-root !important; width: 100% !important; height: 74px !important; min-height: 74px !important; margin-top: .25rem !important; } #top-bar .mobile-top-bar { position: static !important; float: none !important; width: 100% !important; min-height: 66px !important; } }`,
  monotypical:`/* Full-resolution review: the close link remains focused after the #side-bar fragment is cleared, so :focus-within re-raises the drawer and backdrop. Keep target-open and keyboard navigation behavior, but let a non-target closed drawer stay below the page. */\n@media (max-width: 767px) { #side-bar:focus-within:not(:target) { z-index: -1 !important; } }`
};
const imageReviewRepairsV47={
 jakstyle:`/* Full-resolution desktop review: Jakstyle's dark identity surfaces inherited browser-dark ink on burgundy/charcoal controls. Preserve the burgundy palette while restoring readable light labels for tabs, footnotes, header wordmark, sidebar headings, and selected page actions. */\n#page-content .yui-navset .yui-nav li a, #page-content .yui-navset .yui-nav li a *, #page-content .yui-navset .yui-nav li.selected a, #page-content .yui-navset .yui-nav li.selected a * { color: #fff0f2 !important; -webkit-text-fill-color: #fff0f2 !important; }\n#page-content .footnotes-footer, #page-content .footnotes-footer *, #page-content .footnote-footer, #page-content .footnote-footer *, #page-content .footnote, #page-content .footnote * { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }\n#header h1, #header h1 a, #header h1 a span, #header h2, #header h2 span { color: #ffe3e6 !important; -webkit-text-fill-color: #ffe3e6 !important; text-shadow: 0 1px 0 #4e0710 !important; }\n#side-bar .side-block .heading, #side-bar .side-block .heading *, #side-bar .collapsible-block-link { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }\n#page-options-bottom a, #page-options-bottom-2 a, #page-options-bottom a *, #page-options-bottom-2 a * { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }\n#search-top-box-form:focus-within #search-top-box-input, #search-top-box-form:hover #search-top-box-input { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; background-color: #2d1b20 !important; }`,
 'dear-dictator':`/* Heritage credit review: the fixture's absolute Dendo rate strip painted over the author/license line in the short modal. Keep the oxblood/gold heritage treatment, but return the strip to document flow below the credit link. */\n#u-credit-view .modalbox.heritage > .Dendo { position: static !important; width: auto !important; left: auto !important; bottom: auto !important; margin: .75rem 0 0 !important; padding-bottom: .5rem !important; justify-content: center !important; }\n#u-credit-view .modalbox.heritage { padding-bottom: 1rem !important; }\n#action-area table.page-files th:last-child, #action-area table.page-files td:last-child { min-width: 5rem !important; white-space: nowrap !important; }`
};
const imageReviewRepairsV48={
 jakstyle:`/* Re-review of the repaired desktop masthead found a decorative heading layer clipped above the header. Keep the visible logo anchor and subtitle ink, but suppress only the off-canvas parent text layer. */\n#header h1 { color: transparent !important; -webkit-text-fill-color: transparent !important; }\n#header h1 a, #header h1 a span, #header h2, #header h2 span { color: #ffe3e6 !important; -webkit-text-fill-color: #ffe3e6 !important; }`,
 'dear-dictator':`/* Narrow-mobile interaction review: Dear Dictator's fixed search form sat above the mobile menu hit target. Keep both controls visible, but give the menu trigger the higher interaction layer and bound search to its own control. */\n@media (max-width: 767px) { #top-bar .mobile-top-bar { z-index: 20 !important; } #search-top-box { z-index: 14 !important; width: auto !important; max-width: calc(100vw - 7rem) !important; } #search-top-box-form { width: auto !important; } }`
};
const imageReviewRepairsV49={
 jakstyle:`/* The current desktop header exposes the upstream --header-title pseudo-layer above the masthead while the localized logo anchor is already visible. Suppress only that clipped decorative pseudo text; retain the logo artwork, localized title, subtitle, and palette. */\n#header h1::before, #header h1::after { content: none !important; display: none !important; }`
};
const imageReviewRepairsV50={
 jakstyle:`/* Full-resolution after-image identifies the clipped duplicate as #header h1 a::before, which emits the upstream English --header-title over the actual SCP-JP title. Preserve the authored logo background and visible localized anchor text; suppress only this duplicate wordmark pseudo-content. */\n#header h1 > a::before { content: none !important; display: none !important; }`
};
const imageReviewRepairsV51={
 'dear-dictator':`/* The 320px screenshot shows the mobile slogan sharing the logo-art row, where its Japanese lines collide with the SCP-JP wordmark. Reserve the authored logo area, then render the theme slogan as centered lines below it; retain both the Dear Dictator artwork and palette. */\n@media (max-width: 600px) { #header { height: auto !important; min-height: 17rem !important; padding-bottom: 1rem !important; box-sizing: border-box !important; } #header h1 { width: 100% !important; margin: 0 !important; padding: 0 .75rem !important; box-sizing: border-box !important; } #header h1 > a { display: block !important; width: 100% !important; max-width: 100% !important; padding: 8.5rem 0 .75rem !important; transform: none !important; box-sizing: border-box !important; text-align: center !important; } #header h1 > a::before { display: block !important; max-width: 100% !important; margin: 0 auto !important; font-size: clamp(1rem, 4.8vw, 1.3rem) !important; line-height: 1.35 !important; white-space: pre-line !important; overflow-wrap: anywhere !important; box-sizing: border-box !important; } }`
};
const imageReviewRepairsV52={
 jakstyle:`/* Direct review of current theme screenshots found pale page-action text on pale btn-default surfaces, a target-open sidebar that shifted/cropped the article, and the wide SCP Foundation wordmark clipped at the viewport edge. Keep burgundy active controls and logo art while correcting their actual visible surfaces. */
#page-options-bottom a, #page-options-bottom-2 a { color: #5b1020 !important; -webkit-text-fill-color: #5b1020 !important; }
#page-options-bottom #more-options-button, #page-options-bottom-2 #delete-button, #page-options-bottom a:is(:hover,:focus,:focus-visible,:active), #page-options-bottom-2 a:is(:hover,:focus,:focus-visible,:active) { color: #fff0e8 !important; -webkit-text-fill-color: #fff0e8 !important; }
#backlinks-button:not(:is(:hover,:focus,:focus-visible,:active)) { color: #5b1020 !important; -webkit-text-fill-color: #5b1020 !important; }
@media (max-width: 767px) { #side-bar:target + #main-content { left: 0 !important; margin-left: 0 !important; transform: none !important; } }
@media (min-width: 768px) {
 #header { top: 0 !important; position: relative !important; height: var(--final-header-height-on-desktop) !important; min-height: 7.5rem !important; box-sizing: border-box !important; }
 #header h1 { position: relative !important; float: none !important; height: auto !important; max-height: none !important; margin: 0 !important; padding: .8rem 1rem 0 7.5rem !important; line-height: 1.2 !important; box-sizing: border-box !important; }
 #header h1 > a { display: block !important; position: static !important; width: auto !important; height: auto !important; max-height: none !important; margin: 0 !important; padding: 0 !important; line-height: 1.2 !important; white-space: normal !important; }
 #header h1 > a::before { content: "SCP-JP" !important; display: block !important; color: #ffe3e6 !important; -webkit-text-fill-color: #ffe3e6 !important; font: inherit !important; line-height: 1.2 !important; text-shadow: 0 1px 0 #4e0710 !important; }
 #header h1 > a > span { display: none !important; }
 #header h2 { position: relative !important; float: none !important; height: auto !important; max-height: none !important; margin: .15rem 0 0 !important; padding: 0 1rem 0 7.5rem !important; line-height: 1.2 !important; box-sizing: border-box !important; }
 #header h2 > span { display: block !important; position: static !important; height: auto !important; max-height: none !important; margin: 0 !important; padding: 0 !important; line-height: 1.2 !important; }
}`
};
const imageReviewRepairsV53={
 jakstyle:`/* The v52 full-resolution expanded-action after-image showed that older two-ID rules still won for pale Backlinks and disabled Delete controls. Override those exact SCP-JP buttons with readable dark burgundy ink on their current pale disabled surfaces; do not change the remaining action palette. */
#page-options-bottom-2 #backlinks-button, #page-options-bottom-2 #delete-button { color: #5b1020 !important; -webkit-text-fill-color: #5b1020 !important; }`
};
const asModule=css=>`\n\n[[module CSS]]\n${css.trim()}\n[[/module]]\n`;
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const appendOnce=async(file,suffix,marker)=>{
 let text=await fs.readFile(file,'utf8');if(!text.includes(marker)){text=text.replace(/\s*$/u,'')+suffix;await fs.writeFile(file,text)}
 return sha(await fs.readFile(file));
};
const removeLegacyMobileHeaderBlock=async(file,format)=>{
 let text=await fs.readFile(file,'utf8');
 const marker='SCP-JP mobile-header adaptation: the JP shell\'s wider site title overlaps Sigma\'s floated search control at phone widths.';
 const markerAt=text.indexOf(marker);if(markerAt<0)return;
 let start,end;
 if(format==='module'){
  start=text.lastIndexOf('[[module CSS]]',markerAt);
  end=text.indexOf('[[/module]]',markerAt);
  if(start<0||end<0)throw new Error(`Could not bound legacy CSS module in ${file}`);
  end+= '[[/module]]'.length;
 }else{
  start=text.indexOf('@media (max-width: 767px)',markerAt);
  end=text.indexOf('\n}\n',markerAt);
  if(start<0){
   const commentStart=text.lastIndexOf('/*',markerAt);const commentEnd=text.indexOf('*/',markerAt);
   if(commentStart>=0&&commentEnd>=markerAt){const next=`${text.slice(0,commentStart)}\n${text.slice(commentEnd+2)}`;await fs.writeFile(file,next)}
   return;
  }
  if(end<0)throw new Error(`Could not bound legacy responsive block in ${file}`);
  end+='\n}\n'.length;
 }
 const next=`${text.slice(0,start)}\n${text.slice(end)}`;if(next!==text)await fs.writeFile(file,next);
};
const results=[];
for(const slug of themes){
 const dir=path.join(portsDir,slug);
 if(slug==='site'||slug==='wikifot'){
  await removeLegacyMobileHeaderBlock(path.join(dir,'candidate.css'),'css');
  await removeLegacyMobileHeaderBlock(path.join(dir,'candidate.wikidot.txt'),'module');
  try{await removeLegacyMobileHeaderBlock(path.join(dir,'candidate.wikidot.source.txt'),'module')}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const marker='SCP-JP interaction adaptation: reveal Sigma\'s collapsed query input';
 let cssHash=await appendOnce(path.join(dir,'candidate.css'),supportRule,marker);
 let sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),supportModule,marker);
 let normalizedHash=sourceHash;
 try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),supportModule,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 const specific=themeSpecificRules[slug];
 const headerCollisionThemes=['classic','foxtrot','night-rush-theme','paperstack','penumbra','skipos','space','y2k','yossistyle','scpedia'];
 if(specific){
  const themeMarker=slug==='dear-dictator'?'SCP-JP interactive acceptance: dear-dictator visible license policy revision 2':slug==='minimalist-bhl'?'SCP-JP interactive acceptance: minimalist-bhl history control contrast':slug==='jakstyle'?'SCP-JP interactive acceptance: jakstyle history control contrast':slug==='foxtrot'?'SCP-JP interactive acceptance: foxtrot page and sidebar link contrast':slug==='monotypical'?'SCP-JP interactive acceptance: monotypical 320px credit modal responsive revision 2':slug==='redtape'?'SCP-JP interactive acceptance: redtape error dialog text contrast':slug==='ouroborous-theme'?'SCP-JP interactive acceptance: Ouroborous small-text link contrast':slug==='flopstyle-dark'?'SCP-JP interactive acceptance: flopstyle-dark mobile navigation readability revision 2':slug==='site'||slug==='wikifot'?'SCP-JP mobile-header adaptation revision 3':`SCP-JP interactive acceptance: ${slug} account and navigation behavior`;
  const themeRule=specific.includes(themeMarker)?specific:`\n\n/* ${themeMarker} */${specific}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),themeRule,themeMarker);
  const themeModule=asModule(themeRule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),themeModule,themeMarker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),themeModule,themeMarker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const responsiveRepair=responsiveBreakpointRepairs[slug];
 if(responsiveRepair){
  const marker=`SCP-JP responsive breakpoint visual repair v2: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${responsiveRepair}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const followup=[additionalThemeRules[slug],headerCollisionThemes.includes(slug)?additionalThemeRules['mobile-header-themes']:null].filter(Boolean).join('\n');
 if(followup){
  const followupMarker=`SCP-JP interactive visual follow-up v2: ${slug}`;
  const followupRule=`\n\n/* ${followupMarker} */${followup}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),followupRule,followupMarker);
  const followupModule=asModule(followupRule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),followupModule,followupMarker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),followupModule,followupMarker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const evidenceFix=evidenceDrivenVisualFixes[slug];
 if(evidenceFix){
  const evidenceMarker=`SCP-JP interactive visual acceptance evidence fix v1: ${slug}`;
  const evidenceRule=`\n\n/* ${evidenceMarker} */\n${evidenceFix}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),evidenceRule,evidenceMarker);
  const evidenceModule=asModule(evidenceRule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),evidenceModule,evidenceMarker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),evidenceModule,evidenceMarker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const followupFix=followupVisualFixes[slug];
 if(followupFix){
  const followupMarker=`SCP-JP interactive visual acceptance evidence fix v2: ${slug}`;
  const followupRule=`\n\n/* ${followupMarker} */\n${followupFix}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),followupRule,followupMarker);
  const followupModule=asModule(followupRule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),followupModule,followupMarker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),followupModule,followupMarker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const mobileHeaderFix=mobileHeaderVisualFixes[slug];
 if(mobileHeaderFix){
  const mobileHeaderMarker=`SCP-JP interactive visual acceptance mobile header fix v3: ${slug}`;
  const mobileHeaderRule=`\n\n/* ${mobileHeaderMarker} */\n${mobileHeaderFix}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),mobileHeaderRule,mobileHeaderMarker);
  const mobileHeaderModule=asModule(mobileHeaderRule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),mobileHeaderModule,mobileHeaderMarker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),mobileHeaderModule,mobileHeaderMarker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const mobileHeaderRefinement=mobileHeaderRefinements[slug];
 if(mobileHeaderRefinement){
  const marker=`SCP-JP interactive visual acceptance mobile header refinement v5: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${mobileHeaderRefinement}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const mobileHeaderLayoutCorrection=mobileHeaderLayoutCorrections[slug];
 if(mobileHeaderLayoutCorrection){
  const marker=`SCP-JP interactive visual acceptance mobile header layout correction v7: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${mobileHeaderLayoutCorrection}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const mobileHeaderFlowRepair=mobileHeaderFlowRepairs[slug];
 if(mobileHeaderFlowRepair){
  const marker=`SCP-JP interactive visual acceptance mobile header flow repair v8: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${mobileHeaderFlowRepair}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const mobileHeaderNarrowRepair=mobileHeaderNarrowRepairs[slug];
 if(mobileHeaderNarrowRepair){
  const marker=`SCP-JP interactive visual acceptance narrow header repair v9: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${mobileHeaderNarrowRepair}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const reviewedMobileFix=mobileHeaderVisualAcceptanceV10[slug];
 if(reviewedMobileFix){
  const marker=`SCP-JP interactive visual acceptance mobile header correction v11: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${reviewedMobileFix}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const interactionFix=interactionSurfaceVisualFixesV1[slug];
 if(interactionFix){
  const marker=`SCP-JP interactive visual acceptance interaction repair v1: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${interactionFix}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepair=imageReviewRepairs[slug];
 if(imageReviewRepair){
  const marker=`SCP-JP interactive image-review repair v1: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepair}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV2=imageReviewRepairsV2[slug];
 if(imageReviewRepairV2){
  const marker=`SCP-JP interactive visual acceptance image review repair v2: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV2}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV3=imageReviewRepairsV3[slug];
 if(imageReviewRepairV3){
  const marker=`SCP-JP interactive visual acceptance image review repair v3: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV3}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const mobileNavigationRepair=mobileNavigationRepairsV1[slug];
 if(mobileNavigationRepair){
  const marker=`SCP-JP interactive visual acceptance mobile navigation repair v1: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${mobileNavigationRepair}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const mobileNavigationRepairV2=mobileNavigationRepairsV2[slug];
 if(mobileNavigationRepairV2){
  const marker=`SCP-JP interactive visual acceptance mobile navigation repair v2: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${mobileNavigationRepairV2}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const headerOverlapFix=headerOverlapVisualFixesV2[slug];
 if(headerOverlapFix){
  const marker=`SCP-JP interactive visual acceptance header overlap repair v2: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${headerOverlapFix}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const headerNavFix=headerAndNavigationVisualFixesV3[slug];
 if(headerNavFix){
  const marker=`SCP-JP interactive visual acceptance header/navigation repair v3: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${headerNavFix}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const headerLayeringFix=headerLayeringRepairsV4[slug];
 if(headerLayeringFix){
  const marker=`SCP-JP interactive visual acceptance header layering repair v4: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${headerLayeringFix}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV4=imageReviewRepairsV4[slug];
 if(imageReviewRepairV4){
  const marker=`SCP-JP interactive visual acceptance image review repair v4: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV4}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV5=imageReviewRepairsV5[slug];
 if(imageReviewRepairV5){
  const marker=`SCP-JP interactive visual acceptance image review repair v5: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV5}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV6=imageReviewRepairsV6[slug];
 if(imageReviewRepairV6){
  const marker=`SCP-JP interactive visual acceptance image review repair v6: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV6}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV7=imageReviewRepairsV7[slug];
 if(imageReviewRepairV7){
  const marker=`SCP-JP interactive visual acceptance image review repair v7: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV7}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV8=imageReviewRepairsV8[slug];
 if(imageReviewRepairV8){
  const marker=`SCP-JP interactive visual acceptance image review repair v8: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV8}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV9=imageReviewRepairsV9[slug];
 if(imageReviewRepairV9){
  const marker=`SCP-JP interactive visual acceptance image review repair v9: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV9}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV10=imageReviewRepairsV10[slug];
 if(imageReviewRepairV10){
  const marker=`SCP-JP interactive visual acceptance image review repair v10: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV10}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV11=imageReviewRepairsV11[slug];
 if(imageReviewRepairV11){
  const marker=`SCP-JP interactive visual acceptance image review repair v11: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV11}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV12=imageReviewRepairsV12[slug];
 if(imageReviewRepairV12){
  const marker=`SCP-JP interactive visual acceptance image review repair v12: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV12}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV13=imageReviewRepairsV13[slug];
 if(imageReviewRepairV13){
  const marker=`SCP-JP interactive visual acceptance image review repair v13: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV13}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV14=imageReviewRepairsV14[slug];
 if(imageReviewRepairV14){
  const marker=`SCP-JP interactive visual acceptance image review repair v14: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV14}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
 try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV15=imageReviewRepairsV15[slug];
 if(imageReviewRepairV15){
  const marker=`SCP-JP interactive visual acceptance image review repair v15: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV15}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV16=imageReviewRepairsV16[slug];
 if(imageReviewRepairV16){
  const marker=`SCP-JP interactive visual acceptance image review repair v16: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV16}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV17=imageReviewRepairsV17[slug];
 if(imageReviewRepairV17){
  const marker=`SCP-JP interactive visual acceptance image review repair v17: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV17}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV18=imageReviewRepairsV18[slug];
 if(imageReviewRepairV18){
  const marker=`SCP-JP interactive visual acceptance image review repair v18: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV18}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV19=imageReviewRepairsV19[slug];
 if(imageReviewRepairV19){
  const marker=`SCP-JP interactive visual acceptance image review repair v19: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV19}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV20=imageReviewRepairsV20[slug];
 if(imageReviewRepairV20){
  const marker=`SCP-JP interactive visual acceptance image review repair v20: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV20}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV21=imageReviewRepairsV21[slug];
 if(imageReviewRepairV21){
  const marker=`SCP-JP interactive visual acceptance image review repair v21: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV21}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV22=imageReviewRepairsV22[slug];
 if(imageReviewRepairV22){
  const marker=`SCP-JP interactive visual acceptance image review repair v22: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV22}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
 try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV23=imageReviewRepairsV23[slug];
 if(imageReviewRepairV23){
  const marker=`SCP-JP interactive visual acceptance image review repair v23: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV23}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV24=imageReviewRepairsV24[slug];
 if(imageReviewRepairV24){
  const marker=`SCP-JP interactive visual acceptance image review repair v24: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV24}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV25=imageReviewRepairsV25[slug];
 if(imageReviewRepairV25){
  const marker=`SCP-JP interactive visual acceptance image review repair v25: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV25}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV26=imageReviewRepairsV26[slug];
 if(imageReviewRepairV26){
  const marker=`SCP-JP interactive visual acceptance image review repair v26: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV26}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV27=imageReviewRepairsV27[slug];
 if(imageReviewRepairV27){
  const marker=`SCP-JP interactive visual acceptance image review repair v27: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV27}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV28=imageReviewRepairsV28[slug];
 if(imageReviewRepairV28){
  const marker=`SCP-JP interactive visual acceptance image review repair v28: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV28}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV29=imageReviewRepairsV29[slug];
 if(imageReviewRepairV29){
  const marker=`SCP-JP interactive visual acceptance image review repair v29: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV29}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV30=imageReviewRepairsV30[slug];
 if(imageReviewRepairV30){
  const marker=`SCP-JP interactive visual acceptance image review repair v30: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV30}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV31=imageReviewRepairsV31[slug];
 if(imageReviewRepairV31){
  const marker=`SCP-JP interactive visual acceptance image review repair v31: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV31}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV32=imageReviewRepairsV32[slug];
 if(imageReviewRepairV32){
  const marker=`SCP-JP interactive visual acceptance image review repair v32: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV32}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV33=imageReviewRepairsV33[slug];
 if(imageReviewRepairV33){
  const marker=`SCP-JP interactive visual acceptance image review repair v33: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV33}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV34=imageReviewRepairsV34[slug];
 if(imageReviewRepairV34){
  const marker=`SCP-JP interactive visual acceptance image review repair v34: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV34}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV35=imageReviewRepairsV35[slug];
 if(imageReviewRepairV35){
  const marker=`SCP-JP interactive visual acceptance image review repair v35: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV35}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV36=imageReviewRepairsV36[slug];
 if(imageReviewRepairV36){
  const marker=`SCP-JP interactive visual acceptance image review repair v36: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV36}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV37=imageReviewRepairsV37[slug];
 if(imageReviewRepairV37){
  const marker=`SCP-JP interactive visual acceptance image review repair v37: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV37}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV38=imageReviewRepairsV38[slug];
 if(imageReviewRepairV38){
  const marker=`SCP-JP interactive visual acceptance image review repair v38: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV38}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV39=imageReviewRepairsV39[slug];
 if(imageReviewRepairV39){
  const marker=`SCP-JP interactive visual acceptance image review repair v39: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV39}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV40=imageReviewRepairsV40[slug];
 if(imageReviewRepairV40){
  const marker=`SCP-JP interactive visual acceptance image review repair v40: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV40}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV41=imageReviewRepairsV41[slug];
 if(imageReviewRepairV41){
  const marker=`SCP-JP interactive visual acceptance image review repair v41: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV41}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV42=imageReviewRepairsV42[slug];
 if(imageReviewRepairV42){
  const marker=`SCP-JP interactive visual acceptance image review repair v42: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV42}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV43=imageReviewRepairsV43[slug];
 if(imageReviewRepairV43){
  const marker=`SCP-JP interactive visual acceptance image review repair v43: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV43}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV44=imageReviewRepairsV44[slug];
 if(imageReviewRepairV44){
  const marker=`SCP-JP interactive visual acceptance image review repair v44: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV44}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV45=imageReviewRepairsV45[slug];
 if(imageReviewRepairV45){
  const marker=`SCP-JP interactive visual acceptance image review repair v45: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV45}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV46=imageReviewRepairsV46[slug];
 if(imageReviewRepairV46){
  const marker=`SCP-JP interactive visual acceptance image review repair v46: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV46}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV47=imageReviewRepairsV47[slug];
 if(imageReviewRepairV47){
  const marker=`SCP-JP interactive visual acceptance image review repair v47: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV47}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV48=imageReviewRepairsV48[slug];
 if(imageReviewRepairV48){
  const marker=`SCP-JP interactive visual acceptance image review repair v48: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV48}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV49=imageReviewRepairsV49[slug];
 if(imageReviewRepairV49){
  const marker=`SCP-JP interactive visual acceptance image review repair v49: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV49}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV50=imageReviewRepairsV50[slug];
 if(imageReviewRepairV50){
  const marker=`SCP-JP interactive visual acceptance image review repair v50: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV50}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV51=imageReviewRepairsV51[slug];
 if(imageReviewRepairV51){
  const marker=`SCP-JP interactive visual acceptance image review repair v51: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV51}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV52=imageReviewRepairsV52[slug];
 if(imageReviewRepairV52){
  const marker=`SCP-JP interactive visual acceptance image review repair v52: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV52}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const imageReviewRepairV53=imageReviewRepairsV53[slug];
 if(imageReviewRepairV53){
  const marker=`SCP-JP interactive visual acceptance image review repair v53: ${slug}`;
  const rule=`\n\n/* ${marker} */\n${imageReviewRepairV53}`;
  cssHash=await appendOnce(path.join(dir,'candidate.css'),rule,marker);
  const module=asModule(rule);
  sourceHash=await appendOnce(path.join(dir,'candidate.wikidot.txt'),module,marker);
  try{normalizedHash=await appendOnce(path.join(dir,'candidate.wikidot.source.txt'),module,marker)}catch(error){if(error.code!=='ENOENT')throw error}
 }
 const receiptPath=path.join(dir,'receipt.json');
 try{
  const receipt=JSON.parse(await fs.readFile(receiptPath,'utf8'));
  receipt.candidate_source_sha256=normalizedHash;
  receipt.source_candidate_sha256=normalizedHash;
  if('candidate_preview_sha256'in receipt)receipt.candidate_preview_sha256=sourceHash;
  if('candidate_css_sha256'in receipt)receipt.candidate_css_sha256=cssHash;
  if('source_candidate_path'in receipt)receipt.source_candidate_path=`install/local/theme-lab/ports/${slug}/${normalizedHash===sourceHash?'candidate.wikidot.txt':'candidate.wikidot.source.txt'}`;
  if('candidate_source_path'in receipt)receipt.candidate_source_path=`install/local/theme-lab/ports/${slug}/${normalizedHash===sourceHash?'candidate.wikidot.txt':'candidate.wikidot.source.txt'}`;
  await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');
 }catch(error){if(error.code!=='ENOENT')throw error}
 const portPath=path.join(dir,'PORT.md');
 try{
  let port=await fs.readFile(portPath,'utf8');
  port=port.replace(/(Final candidate source\/CSS SHA-256: )[^/]+( \/ )[^.]+/u,`$1${normalizedHash}$2${cssHash}`);
  await fs.writeFile(portPath,port)
 }catch(error){if(error.code!=='ENOENT')throw error}
 results.push({theme:slug,source_sha256:sourceHash,normalized_source_sha256:normalizedHash,css_sha256:cssHash});
}
console.log(JSON.stringify({themes:results.length,adaptation:'sigma-search-input-on-hover-or-focus',results}));
