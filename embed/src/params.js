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
  /* Measured, because the words here were wrong twice over. The old ones said `cards` gave each
     card "its own period, callout and attribution" — it does not, the pane footer is drawn once
     for both layouts. Then "One card each" and "Packed together" implied that `dashboard` was
     the denser of the two, and at 1120px with five widgets it is taller, in more rows, with
     LARGER figures.

     What actually differs is column width. Across 680, 900, 1120 and 1400px, `cards` produced
     exactly one tile width every time and `dashboard` produced two — charts spanning wider
     tracks than single figures. So it is uniform against sized-to-content, and the labels say
     that and nothing else. */
  "data-layout": {
    default: "cards",
    values: {
      cards: "Equal columns",
      dashboard: "Charts get more room",
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
