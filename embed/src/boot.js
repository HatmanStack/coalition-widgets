/* The whole public surface: one script tag.
 *
 *   <script src=".../v1/chc.<hash>.js" integrity="sha384-..." crossorigin="anonymous" defer
 *           data-widgets="hmis-snapshot"></script>
 *
 * It renders where it sits. `document.currentScript` read synchronously at the top gives the
 * tag; the container goes in immediately after it. That works with `defer` and returns null in
 * a module, which is why this ships as a classic IIFE.
 *
 * Several tags on one page cost one download of the file, which is cached. They do not share a
 * store: each execution of an IIFE gets its own module state, so a second tag reading the same
 * cadence asks for that file again and the browser's cache answers. Measured as two entries for
 * quarterly.json in the resource timeline, not one. The store is per pane.
 *
 * ## Every wrong attribute produces something to screenshot
 *
 * The support path is a partner photographing the page and handing the photo to an LLM along
 * with the README. That only works if a mistake is *visible*. Attributes used to fall back to
 * their defaults when they did not parse, so `data-size="huge"` rendered at `auto` and
 * `data-years="five"` showed every year: a widget that looked fine while ignoring what it was
 * asked for, with nothing on screen to photograph and no reason to suspect anything.
 *
 * So a bad value is reported, and reported with its allowed set inline, because the reader is a
 * model looking at a photograph and cannot go and query the catalogue.
 *
 * Reported, not fatal. Configuration problems render as cards above the widgets and the widgets
 * still render beneath them. A typo in an optional attribute must never blank a partner's live
 * page; what the rule protects is that the value is visibly refused rather than silently
 * swallowed, and a card on the page does that. */

import { CATALOGUE, NAMES, SOURCE } from "./widgets/index.js";
import { errorCard, el, paneFoot, skeletonCard, when } from "./dom.js";
import {
  unknownWidget,
  fetchFailed,
  badParam,
  missingParam,
  targetNotFound,
  tooNarrow,
} from "./errors.js";
import { resolveTheme, sizeFor, watchTheme, watchWidth } from "./env.js";
import { ALLOWED, SCALES } from "./params.js";
import { adopt } from "./sheet.js";
import { subscribe } from "./store.js";

const script = document.currentScript;

/* Exactly what the tag passed, in the order it was written, for echoing onto error cards. Read
   from the element rather than rebuilt from parsed options, so a value too broken to parse still
   appears — that is precisely the case somebody is photographing. */
function configOf(tag) {
  if (!tag) return "";
  return [...tag.attributes]
    .filter((a) => a.name.startsWith("data-"))
    .map((a) => `${a.name.slice("data-".length)}=${a.value}`)
    .join("  ");
}
const CONFIG = configOf(script);

/* Below this a card cannot fit a label, a bar and a figure without wrapping into nonsense. The
   smallest step in env.js is 300px and scaling down stops rescuing the layout somewhere under
   250, so this is where the widget says so rather than render something unreadable. */
const MIN_WIDTH = 240;

function attrs(tag) {
  const problems = [];
  const raw = (name) => (tag ? tag.getAttribute(name) : null);

  const oneOf = (name, fallback) => {
    const value = raw(name);
    if (value === null || value === "") return fallback;
    if (!ALLOWED[name].includes(value)) {
      problems.push(badParam(name, value, ALLOWED[name]));
      return fallback;
    }
    return value;
  };

  const widgets = (raw("data-widgets") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!widgets.length) problems.push(missingParam("data-widgets", NAMES));

  // `Number` is too forgiving to use on its own: it turns "" into 0 and "5px" into NaN, and
  // `|| 0` then made both of them mean "show every year" with nothing said about it.
  let years = 0;
  const yearsRaw = raw("data-years");
  if (yearsRaw !== null && yearsRaw.trim() !== "") {
    const parsed = Number(yearsRaw);
    if (Number.isInteger(parsed) && parsed >= 1) {
      years = parsed;
    } else {
      problems.push(
        badParam("data-years", yearsRaw, [
          "a whole number, 1 or more",
          "or leave it off for every published year",
        ]),
      );
    }
  }

  return {
    problems,
    options: {
      widgets,
      theme: oneOf("data-theme", "auto"),
      size: oneOf("data-size", "auto"),
      layout: oneOf("data-layout", "cards"),
      table: oneOf("data-table", "true") !== "false",
      titles: oneOf("data-titles", "true") !== "false",
      years,
      // Valid segments are whatever the payload happens to carry, so this one is checked at
      // render time, where the available keys can be named in the message.
      segment: raw("data-segment") || "all",
      target: raw("data-target"),
    },
  };
}

/* Where the widgets go with no target, or with one that did not resolve. Always the same place,
   immediately after the script tag, because a widget that quietly appears somewhere other than
   where it was aimed reads as a layout bug rather than as a wrong setting. */
function fallbackHost(tag) {
  const host = document.createElement("div");
  if (tag && tag.parentNode) tag.parentNode.insertBefore(host, tag.nextSibling);
  else document.body.appendChild(host);
  return host;
}

function resolveTarget(selector, problems) {
  if (!selector) return null;
  let found;
  try {
    found = document.querySelector(selector);
  } catch {
    // querySelector throws on a malformed selector, and "#3col" is malformed. Uncaught, that
    // takes the whole bundle down here and the page shows nothing at all — the one outcome
    // with nothing to screenshot.
    problems.push(
      badParam("data-target", selector, [
        "a CSS selector such as #reports, .sidebar or [data-slot=chart]",
      ]),
    );
    return null;
  }
  if (!found) {
    problems.push(targetNotFound(selector));
    return null;
  }
  return found;
}

/* Wrap what a widget produced in a grid cell.
 *
 * Every card takes one track of the pane grid, which auto-fits at 300px, so two or three sit
 * across a page and the same tag reflows to one column in a sidebar. Only the composite asks for
 * the whole row, and only when it rendered — a refusal is a short card and stretching it across
 * a full row makes one failed widget look like the whole pane broke. */
function tile(name, node, isError, dense) {
  const span = CATALOGUE[name]?.span;
  // A refusal never takes a dense span: a stat-width cell cannot hold a code, a sentence and a
  // URL without wrapping into nonsense, and an unreadable error costs more than what it reports.
  const cls = isError
    ? span === "full"
      ? "tile"
      : "tile half"
    : dense
      ? `tile ${span || "half"}`
      : span === "full"
        ? "tile full"
        : "tile";
  const wrap = el("div", dense || span === "full" ? cls : "tile");
  wrap.appendChild(node);
  return wrap;
}

/* One script tag is one pane, in one shadow root.
 *
 * Every widget used to get a shadow root of its own, which made a grid across them impossible —
 * the container holding them sat in the light dom where this bundle's stylesheet does not reach,
 * so its layout rules were dead and eleven widgets stacked. One root for the pane puts the grid
 * where the sheet applies, lets a chart sit beside two stats, and lets the attribution be
 * written once instead of once per widget. */
function mountPane(host, options, problems) {
  const shadow = host.attachShadow({ mode: "open" });
  adopt(shadow);
  const dense = options.layout === "dashboard";
  const pane = el("div", dense ? "pane dense" : "pane");
  shadow.appendChild(pane);

  const cadences = new Set();
  for (const n of options.widgets) {
    if (!CATALOGUE[n]) continue;
    cadences.add(CATALOGUE[n].cadence || "quarterly");
    for (const extra of CATALOGUE[n].also || []) cadences.add(extra);
  }
  const files = new Map();
  let narrowAt = null;

  /* One function decides what the whole pane shows. Width and every cadence file arrive
     independently and in any order, so painting from whichever event fired last let a resize
     erase rendered tiles and let a refresh of one file overwrite the others. */
  /* Reserve the space before any data exists.
     Painted synchronously at mount so the pane has close to its final height from the first
     frame. Without it the pane was near-zero until a fetch resolved and then jumped, moving
     everything below it on the partner's page — a 0.19 layout shift on a five-widget pane. */
  const skeleton = () => {
    pane.replaceChildren();
    for (const name of options.widgets) {
      const w = CATALOGUE[name];
      if (!w) continue;
      pane.appendChild(
        tile(name, skeletonCard({ rows: w.rows || 8 }), false, dense),
      );
    }
  };

  /* One line per cadence on this pane, in the order the cadences were named. Built from what
     actually rendered rather than from what was asked for, so a widget that refused does not
     contribute a date for a figure nobody can see. */
  const LABEL = {
    quarterly: (d) => `Quarterly figures as of ${d}`,
    weekly: (d) => `Queue detail from the weekly count of ${d}`,
    live: () => "Housing queue, updated continuously",
    annual: (d) => `Annual figures as of ${d}`,
  };

  const firstAsOf = (payload) => {
    for (const block of [
      "measures",
      "breakdowns",
      "series",
      "comparisons",
      "rates",
    ]) {
      for (const v of Object.values(payload[block] || {})) {
        if (v && v.asOf) return v.asOf;
      }
    }
    for (const v of Object.values(payload.flows || {}))
      if (v && v.asOf) return v.asOf;
    return null;
  };

  const paint = () => {
    pane.replaceChildren();
    let rendered = 0;
    const shown = new Set();

    if (narrowAt !== null) {
      /* Nothing to strip a title from here: this branch renders the too-narrow refusal and
         returns, and no widget has run. A copy of the title-stripping block below sat here and
         read `produced`, which is declared inside the per-widget loop and does not exist in this
         scope — so a pane that was both too narrow and carrying `data-titles="false"` threw
         `produced is not defined` and drew nothing at all, not even the refusal that is the
         entire job of this branch. It went unseen because `data-titles` had no control on any
         page: the condition short-circuits while titles are on, which they are by default. */
      pane.appendChild(
        tile(
          null,
          errorCard({ ...tooNarrow(narrowAt, MIN_WIDTH), config: CONFIG }),
          true,
          dense,
        ),
      );
      return;
    }

    for (const problem of problems) {
      pane.appendChild(
        tile(null, errorCard({ ...problem, config: CONFIG }), true, dense),
      );
    }

    for (const name of options.widgets) {
      if (!CATALOGUE[name]) {
        pane.appendChild(
          tile(
            name,
            errorCard({ ...unknownWidget(name, NAMES), config: CONFIG }),
            true,
            dense,
          ),
        );
        continue;
      }
      const cadence = CATALOGUE[name].cadence || "quarterly";
      const file = files.get(cadence);
      if (!file) continue;

      if (file.error && !file.data) {
        pane.appendChild(
          tile(
            name,
            errorCard({
              ...fetchFailed(`${cadence}.json`, file.error),
              config: CONFIG,
            }),
            true,
            dense,
          ),
        );
        continue;
      }
      if (!file.data) continue;

      // Widgets that read a second file get every payload the pane has loaded. A widget whose
      // extra file has not arrived yet simply renders without it rather than blocking the
      // headline, which is the whole point of the two clocks.
      const payloads = {};
      for (const [c, f] of files) if (f && f.data) payloads[c] = f.data;

      const produced = CATALOGUE[name].render(file.data, {
        payloads,
        stale: file.stale
          ? "Showing the last figures received. A refresh failed."
          : null,
        showTable: options.table,
        dense,
        years: options.years,
        segment: options.segment,
      });
      /* A partner who writes their own heading above the embed would otherwise get it twice.
         Done here rather than threaded through every widget: it is a presentation choice about
         the finished card, and the alternative is the same conditional in eight render methods.
         Sub-headings inside a card stay — they are structure, not a duplicate title. */
      if (!options.titles && !produced.code) {
        produced.querySelectorAll("h3").forEach((h) => h.remove());
      }

      pane.appendChild(
        tile(
          name,
          produced.code ? errorCard({ ...produced, config: CONFIG }) : produced,
          !!produced.code,
          dense,
        ),
      );
      if (!produced.code) {
        rendered += 1;
        shown.add(cadence);
        // A widget reading a second file has its provenance in that file too. Recording only
        // the primary made the queue card claim it was updated continuously while the subgroups
        // and wait bands beneath the headline were a weekly snapshot — the footer stating one
        // clock for a card running two.
        for (const extra of CATALOGUE[name].also || []) {
          if (payloads[extra]) shown.add(extra);
        }
      }
    }

    /* Both layouts, and unconditionally. This used to be dense-only, on the reasoning that a
       card might be embedded alone and should carry its own attribution — but a pane always has
       a footer, and for a single card that footer sits directly beneath it, so nothing is lost.
       What is gained is that three cards from three cadences no longer each whisper their own
       date: the pane states them together, where a reader can see that a March figure is sitting
       beside a January one.

       `data-variant="figure-only"` used to skip this. That made the source and disclaimer line
       switchable from the tag, which is the one thing this project says is not — and no widget
       ever read `variant` for anything else, so the parameter's only effect was the prohibited
       one. Removed rather than narrowed. */
    if (rendered) {
      const periods = [];
      for (const cadence of shown) {
        const data = files.get(cadence)?.data;
        const label = LABEL[cadence];
        if (!data || !label) continue;
        const asOf = firstAsOf(data);
        periods.push(label(asOf ? when(asOf) : ""));
      }
      pane.appendChild(paneFoot(periods, SOURCE));
    }
  };

  const applyTheme = () => {
    const theme = options.theme === "auto" ? resolveTheme(host) : options.theme;
    host.setAttribute("data-chc-theme", theme);
  };
  applyTheme();
  watchTheme(host, applyTheme);

  watchWidth(host, (width) => {
    // Zero means not laid out yet, or inside a hidden tab or a collapsed accordion. That is not
    // too narrow, and telling someone their widget has 0px would send them chasing a problem
    // they do not have.
    const next = width > 0 && width < MIN_WIDTH ? width : null;
    const crossed = (next === null) !== (narrowAt === null);
    narrowAt = next;
    if (crossed) paint();

    const step =
      options.size === "auto"
        ? sizeFor(width)
        : { scale: SCALES[options.size] };
    host.style.setProperty("--chc-scale", step.scale);
  });

  // Before anything is subscribed, so the reserved height is in place from the first frame
  // rather than after a round trip. A pane whose widgets are all unknown skips it: there is
  // nothing to reserve space for and the error cards are the content.
  if (cadences.size) skeleton();

  // A pane with only annual widgets never opens a connection to the live file.
  for (const cadence of cadences) {
    subscribe(cadence, (next) => {
      files.set(cadence, next);
      paint();
    });
  }

  // Nothing subscribed means nothing will ever call paint, and a pane whose only content is a
  // configuration error would stay blank.
  if (!cadences.size) paint();
}

function boot() {
  const { options, problems } = attrs(script);
  const container =
    resolveTarget(options.target, problems) || fallbackHost(script);

  const host = document.createElement("div");
  container.appendChild(host);
  mountPane(host, options, problems);
}

if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
