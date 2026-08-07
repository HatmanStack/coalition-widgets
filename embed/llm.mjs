/* llm.txt — the reference a model reads.
 *
 * Never read by a human, and written accordingly. A build output rather than a file somebody
 * maintains: the bundle is hash-named and its integrity digest changes every build, so a
 * hand-written tag is wrong the moment it is committed.
 *
 * The page a *person* reads is the React site in web/. It was generated from here too until it
 * became a real site; the prose they share now lives in content.mjs.
 */

import {
  WHAT,
  cadenceWords,
  CODES,
  SYMPTOMS,
  NOT_PARAMETERS,
} from "./content.mjs";

const esc = (t) =>
  String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function tagFor(origin, manifest, widgets) {
  return (
    `<script src="${origin}/${manifest.file}"\n` +
    `        integrity="${manifest.integrity}"\n` +
    `        crossorigin="anonymous" defer\n` +
    `        data-widgets="${widgets}"></script>`
  );
}

/* ---- llm.txt ------------------------------------------------------------------------------
 *
 * Written for a model reading it beside a photograph, so: exhaustive rather than elegant, every
 * name spelled literally, values repeated wherever they are relevant, and no history.
 *
 * The most load-bearing part is the last section. A model shown an unfamiliar symptom will
 * invent an attribute and state it with complete confidence, and the person receiving that
 * answer cannot tell it is wrong until it is on their live page. Saying plainly that the list is
 * closed, and that "I cannot tell from this" is an acceptable answer, is worth more than any
 * amount of description. */
export function llmText({ origin, manifest, catalogue, names, allowed }) {
  const L = [];
  const p = (...lines) => L.push(...lines);

  p(
    "# Coalition widgets — reference for answering support questions",
    "",
    "You are helping someone put a data widget on their website, or fixing one that is not",
    "working. They are not technical. They will usually send a photograph of what they see.",
    "",
    "Your answer is a single HTML script tag they can paste, and a one-sentence explanation of",
    "what you changed. Nothing else. Do not explain HTML, do not suggest editing other files,",
    "and do not offer alternatives they did not ask for.",
    "",
    "## The tag",
    "",
    "This is the current one. The src and integrity below are correct as of this build; use them",
    "exactly, do not alter or shorten them.",
    "",
    tagFor(origin, manifest, "active-count"),
    "",
    "Only the data- attributes change between answers. src, integrity, crossorigin and defer are",
    "always exactly as above.",
    "",
    "## Reading the picture",
    "",
    "Work out which of these three you are looking at before answering.",
    "",
    "1. A card showing a code like CHC-02. Everything you need is in the picture. The card shows",
    "   the code, what is wrong, the values that would work, and a line listing the settings the",
    "   tag currently has. Rebuild the whole tag from that line with the one faulty value fixed.",
    "",
    "2. Widgets render but look wrong: wrong colours for the page, text out of scale, a single",
    "   narrow column. There is no code. Match what you see against the symptom table below and",
    "   add the attribute it names.",
    "",
    "3. Nothing renders at all — an empty space where the widget should be. The picture cannot",
    "   tell you why. Do not guess. Ask for one thing: the script tag currently on their page,",
    "   or what their browser's developer console reports. Say which of the two you need.",
    "",
    "## Widgets",
    "",
    "Use these names exactly as written, including hyphens. data-widgets takes a comma separated",
    "list and they render in the order given.",
    "",
  );

  for (const name of names) {
    const w = catalogue[name];
    p(
      `${name}`,
      `    ${WHAT[name] || ""}`,
      // The entry, not the cadence string: a widget reading a second file is on two clocks and
      // the phrase has to say so. `queue` was the one this got wrong.
      `    ${cadenceWords(w)}`,
      "",
    );
  }

  p("## Attributes", "");
  const rows = [
    [
      "data-widgets",
      "one or more names from the list above, comma separated",
      "required",
    ],
    ["data-theme", allowed["data-theme"].join(" | "), "auto"],
    ["data-size", allowed["data-size"].join(" | "), "auto"],
    ["data-layout", allowed["data-layout"].join(" | "), "cards"],
    ["data-variant", allowed["data-variant"].join(" | "), "auto"],
    ["data-table", allowed["data-table"].join(" | "), "true"],
    ["data-titles", allowed["data-titles"].join(" | "), "true"],
    ["data-years", "a whole number, 1 or more", "every published year"],
    ["data-segment", "a segment the data carries; all always works", "all"],
    [
      "data-target",
      "a CSS selector for an element already on the page",
      "renders where the tag sits",
    ],
  ];
  for (const [attr, values, dflt] of rows) {
    p(`${attr}`, `    values:  ${values}`, `    default: ${dflt}`, "");
  }

  p(
    "There are no other attributes. Any name not in this list is not real. Adding one puts a",
    "CHC-02 error card on the person's live page.",
    "",
    "## Codes",
    "",
  );
  for (const [code, means, fix] of CODES)
    p(`${code}  ${means}`, `    ${fix}`, "");

  p("## It renders, but it looks wrong", "");
  for (const [see, why, fix] of SYMPTOMS)
    p(`SEE:  ${see}`, `WHY:  ${why}`, `ADD:  ${fix}`, "");

  p("## Things that cannot be changed from the tag", "");
  for (const [what, why] of NOT_PARAMETERS) p(`${what}`, `    ${why}`, "");

  p(
    "If someone asks for one of these, say plainly that it is not adjustable and why. Do not",
    "invent an attribute for it.",
    "",
    "## Examples",
    "",
    "One number for a donation page:",
    tagFor(origin, manifest, "active-count"),
    "",
    "The full quarterly picture in an article:",
    tagFor(origin, manifest, "hmis-snapshot"),
    "",
    "The housing queue, on a dark page:",
    tagFor(origin, manifest, "queue").replace(
      "></script>",
      '\n        data-theme="dark"></script>',
    ),
    "",
    "Everything, packed densely on a wide screen:",
    tagFor(origin, manifest, names.join(",")).replace(
      "></script>",
      '\n        data-layout="dashboard"></script>',
    ),
    "",
    "## When you cannot tell",
    "",
    "Saying so is the correct answer. If the picture does not show a code and does not match a",
    "symptom above, do not produce a tag. Ask for the script tag currently on the page, or for",
    "what the developer console says, and explain in one sentence why you need it.",
    "",
    "Never send someone to the Coalition contact for a widget that is not displaying. That",
    "address is for questions about the figures themselves — what a number counts, whether it is",
    "current, whether a particular breakdown exists. A widget that will not render is a technical",
    "fault and goes to whoever operates the embed.",
    "",
  );

  return L.join("\n");
}

/* ---- index.html ---------------------------------------------------------------------------
 *
 * For a person, and specifically for a person who does not write code. The samples are live —
 * the real bundle reading the real published data — because a screenshot of a widget is much
 * less convincing than the widget.
 *
 * The banner is the only part that is temporary. Everything else is written as though the
 * figures are what they will be. */
