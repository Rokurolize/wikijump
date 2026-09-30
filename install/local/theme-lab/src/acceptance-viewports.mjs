// The current acceptance contract measures every defined form factor. Keep
// this list shared by visual, overflow, and torture checks so a newly added
// viewport cannot silently fall out of one acceptance dimension.
export const ACCEPTANCE_VIEWPORTS = Object.freeze([
  {id: "desktop", width: 1440, height: 1000},
  {id: "laptop", width: 1024, height: 900},
  {id: "tablet", width: 768, height: 1024},
  {id: "mobile", width: 390, height: 844},
  {id: "narrow-mobile", width: 320, height: 800},
]);

export const ACCEPTANCE_VIEWPORT_IDS = Object.freeze(ACCEPTANCE_VIEWPORTS.map(({id}) => id));
