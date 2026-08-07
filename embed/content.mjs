/* The prose, kept apart from anything that renders it.
 *
 * One copy, two audiences: `llm.mjs` turns it into llm.txt for a model, and the React site in
 * web/ renders it for a person. Both import from here rather than restating it, because a
 * documentation table is the place drift does the most damage — the reader acts on it.
 */

export const WHAT = {
  "hmis-snapshot":
    "Every quarterly figure in one card: the headline counts, race and ethnicity, and where people are staying.",
  "active-count": "How many people are experiencing homelessness right now.",
  "queue-total": "How many people are waiting for housing, as a single number.",
  /* "who they are" promised identification, on a card whose whole subject is a queue of named
     people in HMIS. Every figure on it is a count of a group — the subgroups overlap, the waits
     are bands, and both fall under the small-cell rule. The description has to say group, and it
     must not single out the one figure on the card that moves faster than the rest: this text
     sits under an "updates weekly" heading and that is the whole statement. See slowestCadence. */
  queue:
    "The housing queue: how many people are waiting, how many are in groups such as veterans or unaccompanied youth, and how long people have been waiting. Every figure is a count of a group, never a person.",
  "race-ethnicity": "Who is experiencing homelessness, by race and ethnicity.",
  county: "Where people are, by county.",
  "shelter-status":
    "Where people are staying: shelter, transitional housing, or unsheltered.",
  "pit-trend":
    "The January census over recent years, sheltered against unsheltered.",
  "newly-homeless": "How many households became homeless each year.",
  "inflow-outflow":
    "How many people became homeless against how many were housed or left.",
  "alice-gap": "What a household earns against what it costs to live here.",
  "length-of-stay":
    "How long people spend homeless, locally against the national figure.",
  retention: "How many people are still housed two years after support ended.",
};

export const CADENCE_WORDS = {
  live: "updates continuously",
  weekly: "updates weekly",
  quarterly: "updates quarterly",
  annual: "updates yearly",
};

/* Fastest first. The order the catalogue is listed in, and the scale that decides which of a
   widget's clocks is the slow one. A cadence not named here sorts last and still gets a group of
   its own, so adding one to the registry degrades to "listed at the end", never "dropped". */
export const CADENCE_ORDER = ["live", "weekly", "quarterly", "annual"];

const rank = (c) => {
  const i = CADENCE_ORDER.indexOf(c);
  return i === -1 ? CADENCE_ORDER.length : i;
};

/* The clock the whole card is described by: the SLOWEST file it reads, never the fastest.
 *
 * `queue` is the case, and the only one — its headline count comes off the live file and its
 * subgroups and wait bands come off the weekly one. Describing it as "updates continuously"
 * oversold every figure on it but one, and `queue-total` is the only continuous number
 * published.
 *
 * The obvious repair is to say both clocks — "the headline count updates continuously,
 * everything else updates weekly" — and that is worse than the fault. It is precisely the
 * differencing recipe: it names the figure that moves and the figures to hold still against it,
 * which is the observation the one-live-measure rule exists to prevent. The catalogue does not
 * hand a reader that. It says "updates weekly" and stops.
 *
 * Understating freshness is the safe direction to be wrong in: a partner is promised a figure no
 * fresher than they get. Do not "fix" this back into an accurate compound phrase. */
export function slowestCadence(entry) {
  return [entry.cadence, ...(entry.also || [])].sort(
    (a, b) => rank(b) - rank(a),
  )[0];
}

export function cadenceWords(entry) {
  const c = slowestCadence(entry);
  return CADENCE_WORDS[c] || c;
}

export const CODES = [
  [
    "CHC-01",
    "A name in data-widgets is not a widget.",
    "Replace it with a name from the widget list. The message on the card lists every valid name. Names are case sensitive; spaces around a name and a trailing comma are ignored, so neither is the fault.",
  ],
  [
    "CHC-02",
    "An attribute has a value that is not allowed, or the tag carries no data-widgets at all.",
    "The card names the attribute, the value it received, and the values that would work. Use one of those.",
  ],
  [
    "CHC-03",
    "The data file could not be loaded.",
    "Not something the tag can fix. If it says 403 or 404 that file has not been published yet; otherwise a content policy on the page, or something in the browser, is blocking the request. Every widget reading that file shows the same card.",
  ],
  [
    "CHC-04",
    "The figure a widget needs is not in the file it reads.",
    "Two different faults wearing one code. On inflow-outflow it means data-segment names a segment that is not published, and the card lists the ones that are — use one of those, or drop data-segment. On every other widget it means the figure itself has not been published, which no attribute can fix: take that name out of data-widgets.",
  ],
  [
    "CHC-05",
    "data-target names an element that is not on the page.",
    "Add an element with that id or class, or remove data-target so the widget renders where the script tag sits. The element has to be in the page's own HTML — one that another script creates later is not there yet when the widget looks.",
  ],
  [
    "CHC-06",
    "The container is narrower than 240 pixels.",
    "Give it more room, or show fewer widgets side by side. It reappears on its own once there is space. While it is showing it is the only thing on the pane, so fix the width before reading anything else into the picture.",
  ],
];

export const SYMPTOMS = [
  [
    "A light widget on a dark background, or a dark one on a light background.",
    "The theme is measured from the background colour behind the widget. A background image or a gradient reports no colour, so it reads through to whatever is underneath.",
    'data-theme="dark" or data-theme="light"',
  ],
  [
    "The theme is right when the page loads but wrong after a dark-mode toggle.",
    "The toggle changes something the widget does not watch.",
    "data-theme set explicitly, which stops it following the page",
  ],
  [
    "The text is much bigger or smaller than the page around it.",
    "The widget inherits the page's font size, capped so an unusual size cannot run away with the layout.",
    'data-size="sm" or data-size="lg"',
  ],
  [
    "One column, with empty space either side.",
    "Each card needs about 300 pixels, so a container narrower than 600 fits one.",
    'a wider container, or data-layout="dashboard" to pack more densely',
  ],
  [
    "A very long single column of cards.",
    "Many widgets in a narrow container.",
    'fewer names in data-widgets, or data-layout="dashboard"',
  ],
  [
    "The heading appears twice.",
    "The page has its own heading above the embed and the card carries one too.",
    'data-titles="false"',
  ],
];

export const NOT_PARAMETERS = [
  [
    "Colours",
    "The chart palette is fixed. It is chosen so the series stay distinguishable for the most common forms of colour blindness, which a brand palette usually is not.",
  ],
  [
    "How often the figures refresh",
    "Set where the data is published, not on the page. The widget re-reads on its own schedule.",
  ],
  [
    "Where the data comes from",
    "Compiled into the bundle. This is what lets a site allow one fixed address in its content security policy.",
  ],
  [
    "The source and disclaimer line",
    "Always shown. These figures are published as unaffiliated concept work and the attribution travels with them.",
  ],
  ["Fonts", "Inherited from the page automatically. Nothing to set."],
];
