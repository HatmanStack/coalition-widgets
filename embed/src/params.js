/* What the tag accepts. Data only, and deliberately in its own module.
 *
 * `build.mjs` generates the published documentation from this, so the parameter tables a partner
 * reads are the same values the bundle enforces rather than a second copy somebody keeps in
 * step. It cannot live in boot.js: that reads `document.currentScript` at module scope and so
 * cannot be imported outside a browser.
 */

export const SCALES = { xs: 0.8, sm: 0.9, md: 1, lg: 1.15, xl: 1.3 };

export const ALLOWED = {

  "data-theme": ["auto", "light", "dark"],
  "data-size": ["auto", ...Object.keys(SCALES)],
  // Two layouts, neither of them the right one. `cards` gives each statistic a card of its own
  // with its own period, callout and attribution — a story down a page, which is what a partner
  // dropping three widgets into a post wants. `dashboard` packs figures several across with
  // attribution once at the foot, which is what all eleven on a wallboard wants.
  "data-layout": ["cards", "dashboard"],
  "data-table": ["true", "false"],
  "data-titles": ["true", "false"],
};
