// The Files pane of a Wikidot-layout page is the PageFilesModule attachment
// list: `table.page-files` with one `tr#file-row-N` per attachment inside
// `div.file-list-scroll`. Framerail rendered a native `.file-list`/`.file-row`
// div list for this fixture until #2067 (2026-10-19). Capture and probe code
// must wait for the Wikidot DOM and must not accept an empty or absent pane:
// the empty pane renders no table, so these selectors time out (fail closed).
export const FILES_PANE = Object.freeze({
  table: "#action-area table.page-files",
  row: "#action-area table.page-files tr[id^='file-row-']",
  scroller: ".file-list-scroll",
});
