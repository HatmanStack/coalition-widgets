/* What the tag accepts. Data only, and deliberately in its own module.
 *
 * `build.mjs` generates the published documentation and the manifest from this, so the parameter
 * tables a partner reads are the same values the bundle enforces rather than a second copy
 * somebody keeps in step. It cannot live in boot.js: that reads `document.currentScript` at
 * module scope and so cannot be imported outside a browser.
 *
 * Each parameter carries three things, because three separate places used to know one each and
 * none of them agreed:
 *
 *   values    what may be written, and what that choice does in words. The words are here rather
 *             than in the site, so a new parameter arrives already speakable. `true`/`false` on a
 *             control labelled "table" asks a question nobody posed; "Show table view" is the
 *             question actually being answered.
 *   default   what happens when the attribute is absent. This lived in boot.js as the second
 *             argument to `oneOf` and nowhere else, so nothing downstream could know it.
 *
 * That last gap is why the builder offered false choices. `oneOf` returns the fallback when the
 * attribute is absent AND when it is present at its own default, so leaving `data-theme` off and
 * writing `data-theme="auto"` produce byte-identical output — measured, on all five. Offering
 * both is asking somebody to decide something that has no consequence. With the default named
 * here, a control can collapse the pair into one option and emit nothing for it, which is also
 * the shortest tag.
 */

export const SCALES = { xs: 0.8, sm: 0.9, md: 1, lg: 1.15, xl: 1.3 };

export const PARAMS = {
  "data-theme": {
    default: "auto",
    values: {
      auto: "Match the page",
      light: "Always light",
      dark: "Always dark",
    },
  },
  "data-size": {
    default: "auto",
    values: {
      auto: "Fit the space",
      xs: "Extra small",
      sm: "Small",
      md: "Medium",
      lg: "Large",
      xl: "Extra large",
    },
  },
  // Two layouts, neither of them the right one. `cards` gives each statistic a card of its own
  // with its own period, callout and attribution — a story down a page, which is what a partner
  // dropping three widgets into a post wants. `dashboard` packs figures several across with
  // attribution once at the foot, which is what all thirteen on a wallboard wants.
  "data-layout": {
    default: "cards",
    values: {
      cards: "One card each",
      dashboard: "Packed together",
    },
  },
  "data-table": {
    default: "true",
    values: {
      true: "Show table view",
      false: "Hide table view",
    },
  },
  "data-titles": {
    default: "true",
    values: {
      true: "Show headings",
      false: "Hide headings",
    },
  },
};

/* The shape the bundle validates against, derived rather than restated. `badParam` prints this
   list back to a partner on a CHC-02 card, so it has to stay the bare values. */
export const ALLOWED = Object.fromEntries(
  Object.entries(PARAMS).map(([attr, spec]) => [
    attr,
    Object.keys(spec.values),
  ]),
);
