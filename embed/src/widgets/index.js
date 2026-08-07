/* The catalogue. Each widget is a pure function of (payload, options) returning a node, plus the
 * cadence file it reads. Adding one means adding a row here. */

import {
  card,
  el,
  fmt,
  group,
  legendOf,
  stat,
  table as tableOf,
  when,
} from "../dom.js";
import { bars, columns, stack } from "../chart.js";
import { noData } from "../errors.js";

const S1 = "var(--chc-s1)";
const S2 = "var(--chc-s2)";
const S3 = "var(--chc-s3)";
const UNK = "var(--chc-unknown)";

const period = (asOf) => `As of ${when(asOf)}`;
export const SOURCE =
  "Source: Coalition HMIS via Looker. Unaffiliated concept, not endorsed.";

function figure(value, label, delta) {
  const nodes = [
    el("div", "figure", fmt(value)),
    el("p", "figure-label", label),
  ];
  if (delta) nodes.push(el("p", "note", delta));
  return nodes;
}

/* ---- measure widgets ---- */

function measureWidget(id, label, { note = null, hero = false } = {}) {
  return {
    rows: 5,
    // Only consulted by data-layout="dashboard". In the card layout every widget takes one
    // track and a span would be meaningless.
    span: hero ? "hero" : "stat",
    cadence: (payload) => payload.meta.cadence,
    needs: `measures.${id}`,
    render(payload, { stale, dense }) {
      const m = payload.measures && payload.measures[id];
      if (!m)
        return noData(
          id,
          `measures.${id}`,
          Object.keys(payload.measures || {}),
        );
      // Dense means this figure is one cell of a wallboard, so the period and attribution that
      // would repeat under every tile move to the foot of the pane.
      if (dense) return stat({ stale, value: m.value, label });
      return card({
        stale,
        body: figure(m.value, label),
        note,
      });
    },
  };
}

/* ---- breakdown widgets ---- */

function breakdownWidget(id, title, form) {
  return {
    rows: 8,
    span: "half",
    needs: `breakdowns.${id}`,
    render(payload, { stale, showTable }) {
      const b = payload.breakdowns && payload.breakdowns[id];
      if (!b)
        return noData(
          id,
          `breakdowns.${id}`,
          Object.keys(payload.breakdowns || {}),
        );

      const items = b.categories.map((c) => ({
        label: c.label,
        value: c.value,
      }));
      if (b.residual)
        items.push({
          label: b.residual.label,
          value: b.residual.value,
          muted: true,
        });

      const rows = items.map((i) => [i.label, i.value]);
      const total = items.reduce((a, i) => a + i.value, 0);
      rows.push(["Total", total]);

      let body,
        legend = null;
      if (form === "stack") {
        const colors = [S1, S2, S3, UNK];
        body = [
          stack(
            items.map((i, n) => ({
              value: i.value,
              color: colors[Math.min(n, 3)],
            })),
          ),
        ];
        legend = legendOf(
          items.map((i, n) => [
            `${i.label} ${fmt(i.value)}`,
            colors[Math.min(n, 3)],
          ]),
        );
      } else {
        body = [bars(items)];
      }

      return card({
        stale,
        title,
        body,
        legend,
        table: showTable ? tableOf(["Category", "People"], rows) : null,
        note:
          total === b.universe
            ? null
            : `These categories sum to ${fmt(total)} against a stated population of ${fmt(b.universe)}.`,
      });
    },
  };
}

/* ---- series and comparison widgets ---- */

function seriesWidget(id, title, { stacked = null, note = null } = {}) {
  return {
    rows: 14,
    span: "wide",
    needs: `series.${id}`,
    render(payload, { stale, showTable, years }) {
      const series = payload.series && payload.series[id];
      if (!series)
        return noData(id, `series.${id}`, Object.keys(payload.series || {}));

      let points = series.points;
      // `data-years` takes the most recent N of the PUBLISHED span. It never invents slots
      // before the series began, and a gap inside the span stays a labelled empty slot.
      if (years && years > 0 && years < points.length)
        points = points.slice(-years);

      const [cols, axis] = columns(points, { stacked });
      const headers = stacked
        ? ["Year", ...stacked.map((p) => p.label), "Total"]
        : ["Year", "Count"];
      const rows = points.map((p) =>
        stacked
          ? [p.label, ...stacked.map((s) => p[s.key] ?? 0), p.value ?? 0]
          : [p.label, p.value ?? 0],
      );

      return card({
        stale,
        title,
        body: [cols, axis],
        legend: stacked
          ? legendOf(stacked.map((p) => [p.label, p.color]))
          : null,
        table: showTable ? tableOf(headers, rows) : null,
        note,
      });
    },
  };
}

/* `higherIsBetter` is a property of the MEASURE, not of the gap.
 *
 * It was `higherIsWorse`, tested against `there - here`, which conflated two different
 * questions: whether a high value is a bad thing, and whether `here` is doing better than
 * `there`. Both comparison widgets came out inverted, and the ALICE card told readers that a
 * household earning 14,300 dollars a year LESS than it needs to live was "better than the
 * comparison" — the exact opposite of the point of the statistic.
 *
 * Asked this way there is nothing to get backwards: income, higher is better; days spent
 * homeless, lower is better. */
function comparisonWidget(id, title, { unit = "", higherIsBetter } = {}) {
  if (typeof higherIsBetter !== "boolean") {
    throw new Error(
      `${id}: higherIsBetter must be set; there is no safe default for a direction`,
    );
  }
  return {
    rows: 12,
    span: "half",
    needs: `comparisons.${id}`,
    render(payload, { stale, showTable }) {
      const c = payload.comparisons && payload.comparisons[id];
      if (!c)
        return noData(
          id,
          `comparisons.${id}`,
          Object.keys(payload.comparisons || {}),
        );

      const items = [
        { label: c.hereLabel, value: c.here },
        { label: c.thereLabel, value: c.there, muted: true },
      ];
      const gap = Math.abs(c.there - c.here);
      const better = higherIsBetter ? c.here > c.there : c.here < c.there;

      return card({
        stale,
        title,
        body: [...figure(c.here, c.hereLabel), bars(items)],
        table: showTable
          ? tableOf(
              ["", unit || "Value"],
              items.map((i) => [i.label, i.value]),
            )
          : null,
        callout: {
          // Naming the other side rather than "the comparison". A reader who has to work out
          // what is being compared will guess, and the guess is where the meaning gets lost.
          big: `${fmt(gap)} ${unit} ${better ? "better" : "worse"} than ${c.thereLabel}.`,
          small: c.note || null,
        },
      });
    },
  };
}

/* ---- inflow against outflow, the functional zero measure ---- */

const inflowOutflow = {
  rows: 12,
  span: "half",
  needs: "flows",
  render(payload, { stale, showTable, segment }) {
    const flows =
      payload.flows &&
      payload.flows[segment && segment !== "all" ? segment : "all"];
    // The one place a payload key is chosen by an attribute, so the available keys go in the
    // message: this is what tells a partner that data-segment="familes" should have been
    // "families", and it is the only way they could find that out.
    if (!flows) {
      return noData(
        "inflow-outflow",
        `flows.${segment || "all"} (from data-segment)`,
        Object.keys(payload.flows || {}),
      );
    }

    const items = [
      { label: "Became homeless", value: flows.in },
      { label: "Housed or exited", value: flows.out, muted: true },
    ];
    const net = flows.in - flows.out;

    return card({
      stale,
      title: "Moving people out, against how many arrive",
      body: [bars(items)],
      callout: {
        big:
          net === 0
            ? "Inflow and outflow balanced."
            : net > 0
              ? `${fmt(flows.out)} people left homelessness. Inflow ran ${fmt(net)} ahead.`
              : `${fmt(Math.abs(net))} more people left homelessness than became homeless.`,
        small:
          net > 0
            ? "The gap is not a throughput problem. More households are becoming homeless for the first time than the system can move out, which is a question about housing cost rather than about case management."
            : "More people leaving than arriving is what functional zero looks like in practice.",
      },
      table: showTable
        ? tableOf(
            ["Direction", "People"],
            items.map((i) => [i.label, i.value]),
          )
        : null,
      note: "This is the measure that says whether the work is succeeding.",
    });
  },
};

/* ---- a proportion, drawn as a meter ---- */

const retention = {
  rows: 5,
  span: "half",
  needs: "rates.retention",
  render(payload, { stale }) {
    const r = payload.rates && payload.rates.retention;
    if (!r) return noData("retention", "rates.retention");

    const meter = el("div", "stack");
    const kept = el("span");
    kept.style.width = `calc(${r.percent}% - 2px)`;
    kept.style.background = "var(--chc-s3)";
    const rest = el("span");
    rest.style.width = `calc(${(100 - r.percent).toFixed(1)}% - 2px)`;
    rest.style.background = "var(--chc-unknown)";
    meter.appendChild(kept);
    meter.appendChild(rest);

    return card({
      stale,
      title: "Still housed two years on",
      body: [el("div", "figure", `${r.percent}%`), meter],
      note: r.note,
    });
  },
};

/* ---- the housing queue ---- */

const SUBGROUPS = [
  ["veterans", "Veterans"],
  ["chronicallyHomeless", "Chronically homeless"],
  ["unaccompaniedYouth", "Unaccompanied youth"],
  ["parentingYouthHouseholds", "Parenting youth households"],
  ["olderAdults", "Aged 55 to 61"],
  ["seniors", "Aged 62 and over"],
];

/* One card, two clocks.
 *
 * The count at the top moves live; everything beneath it moves weekly. Splitting them across
 * separate widgets would put overlapping subgroups side by side looking like parts of a whole —
 * a veteran may also be chronically homeless, and they do not sum to the queue. Under one
 * heading, with the total as the headline and the rest labelled as a slower snapshot, the
 * relationship is legible.
 *
 * Waiting time is shown as bands rather than an average. A mean published beside its denominator
 * gives up individual tenures to subtraction: the week-on-week change in mean x count is exactly
 * the waiting time that left the queue, and for one departure that is one person's wait.
 */
const queue = {
  rows: 20,
  span: "half",
  needs: "measures.queueTotal",
  render(payload, { stale, showTable, payloads = {} }) {
    const m = payload.measures || {};
    if (!m.queueTotal) {
      return noData("queue", "measures.queueTotal", Object.keys(m));
    }

    const body = [
      el("div", "figure", fmt(m.queueTotal.value)),
      el("p", "figure-label", "people waiting for housing right now"),
    ];

    const week = payloads.weekly;
    const wm = (week && week.measures) || {};
    const cells = SUBGROUPS.filter(([id]) => wm[id]).map(([id, label]) => [
      label,
      wm[id].value,
    ]);

    if (cells.length) {
      /* "Who is waiting" reads as a promise to say who, above a grid of group counts. It is
         how many are in each group, and the overlap note under the grid only makes sense once
         the heading has said "group" first. The weekly qualifier stays: it is the line that
         stops the live total at the top being read as the clock for everything beneath it. */
      body.push(
        el(
          "h4",
          "sub",
          "How many are in each group, as of the last weekly count",
        ),
      );
      const grid = el("div", "group");
      for (const [label, value] of cells) {
        const cell = el("div", "cell");
        cell.appendChild(el("div", "n", fmt(value)));
        cell.appendChild(el("div", "k", label));
        grid.appendChild(cell);
      }
      body.push(grid);
      body.push(
        el(
          "p",
          "note",
          "These groups overlap — somebody may be counted in more than one — so they do not add up to the total above.",
        ),
      );
    }

    const bands = week && week.breakdowns && week.breakdowns.waitBands;
    let table = null;
    if (bands) {
      body.push(el("h4", "sub", "How long people have been waiting"));
      body.push(
        bars(bands.categories.map((c) => ({ label: c.label, value: c.value }))),
      );
      const longest = bands.categories[bands.categories.length - 1];
      if (longest) {
        body.push(
          el(
            "p",
            "note",
            `${fmt(longest.value)} of them have been waiting ${longest.label.toLowerCase()}.`,
          ),
        );
      }
      if (showTable) {
        table = tableOf(
          ["Wait", "People"],
          bands.categories.map((c) => [c.label, c.value]),
        );
      }
    }

    return card({ stale, title: "The housing queue", body, table });
  },
};

/* ---- the composite ---- */

const hmisSnapshot = {
  rows: 22,
  span: "full",
  needs: "measures and breakdowns",
  render(payload, { stale, showTable }) {
    const m = payload.measures || {};
    const tiles = [
      ["activelyHomeless", "People actively experiencing homelessness"],
      ["personsInFamilyHouseholds", "People in family households"],
      ["personsInYouthHouseholds", "People in youth households"],
      ["familyHouseholds", "Family households"],
    ].filter(([id]) => m[id]);

    if (!tiles.length) return noData("hmis-snapshot", "measures");

    // Figures, not a label-and-number list. These were `.bar-row`s with the bar column left
    // empty, which reads as a table that lost its chart rather than as the headline numbers of
    // a dashboard.
    const grid = el("div", "group");
    for (const [id, label] of tiles) {
      const cell = el("div", "cell");
      cell.appendChild(el("div", "n", fmt(m[id].value)));
      cell.appendChild(el("div", "k", label));
      grid.appendChild(cell);
    }

    const body = [grid];
    for (const [id, title, form] of [
      ["raceEthnicity", "Race and ethnicity", "bars"],
      ["shelterStatus", "Where people are staying", "stack"],
    ]) {
      const b = payload.breakdowns && payload.breakdowns[id];
      if (!b) continue;
      body.push(el("h3", null, title));
      const items = b.categories.map((c) => ({
        label: c.label,
        value: c.value,
      }));
      if (b.residual)
        items.push({
          label: b.residual.label,
          value: b.residual.value,
          muted: true,
        });
      if (form === "stack") {
        const colors = [S1, S2, S3, UNK];
        body.push(
          stack(
            items.map((i, n) => ({
              value: i.value,
              color: colors[Math.min(n, 3)],
            })),
          ),
        );
        body.push(
          legendOf(
            items.map((i, n) => [
              `${i.label} ${fmt(i.value)}`,
              colors[Math.min(n, 3)],
            ]),
          ),
        );
      } else {
        body.push(bars(items));
      }
    }

    const first = m[tiles[0][0]];
    return card({
      stale,
      title: "Homeless services dashboard",
      body,
      table: showTable
        ? tableOf(
            ["Measure", "Value"],
            tiles.map(([id, label]) => [label, m[id].value]),
          )
        : null,
      note: "Counts anyone with a live enrolment on the last day of the period, each person once.",
    });
  },
};

const S1_ = "var(--chc-s1)";
const S2_ = "var(--chc-s2)";

/* Which file a widget reads, declared beside the widget rather than in a second map.
 *
 * The cadence and the extra-cadence list used to live in boot.js while the span, the nominal
 * height and the needs string lived here — one widget described in two files. Adding `queue`
 * meant editing both, and forgetting the boot.js half is silent: a widget with no entry there
 * defaulted to quarterly and simply never found its data.
 *
 * `also` is for a widget reading a second file. The queue is the case: its headline count moves
 * live and everything else about it moves weekly, on purpose. */
const on = (cadence, widget, also) => ({
  ...widget,
  cadence,
  ...(also ? { also } : {}),
});

export const CATALOGUE = {
  "hmis-snapshot": on("quarterly", hmisSnapshot),
  "active-count": on(
    "quarterly",
    measureWidget(
      "activelyHomeless",
      "people actively experiencing homelessness",
      { hero: true },
    ),
  ),
  /* The single number before the card it is the headline of. This order is what every list of
     widgets renders in — the builder's checkboxes, llm.txt, the deploy smoke page — so the
     simpler and safer of the two is the one a partner meets first. It is also the only figure
     published continuously, and the one whose name is easiest to mistake for the other's. */
  "queue-total": on(
    "live",
    measureWidget("queueTotal", "people waiting for housing right now", {
      hero: true,
    }),
  ),
  queue: on("live", queue, ["weekly"]),
  "race-ethnicity": on(
    "quarterly",
    breakdownWidget("raceEthnicity", "Race and ethnicity", "bars"),
  ),
  county: on(
    "quarterly",
    breakdownWidget("county", "Where people came from", "bars"),
  ),
  "shelter-status": on(
    "quarterly",
    breakdownWidget("shelterStatus", "Where people are staying", "stack"),
  ),
  "pit-trend": on(
    "annual",
    seriesWidget("pitCount", "The January census", {
      stacked: [
        { key: "sheltered", label: "Sheltered", color: S1_ },
        { key: "unsheltered", label: "Unsheltered", color: S2_ },
      ],
      note: "Counted on a single night in January. Colder weather pushes more people into shelter, so year on year change reflects conditions as well as counting.",
    }),
  ),
  "newly-homeless": on(
    "annual",
    seriesWidget("newlyHomeless", "Households becoming homeless each year"),
  ),
  "inflow-outflow": on("annual", inflowOutflow),
  "alice-gap": on(
    "annual",
    comparisonWidget(
      "aliceGap",
      "What a household needs against what it earns",
      {
        unit: "dollars a year",
        // A household's income. Earning more is better.
        higherIsBetter: true,
      },
    ),
  ),
  "length-of-stay": on(
    "annual",
    comparisonWidget("lengthOfStay", "Days spent homeless", {
      unit: "days",
      // Days spent homeless. Fewer is better.
      higherIsBetter: false,
    }),
  ),
  retention: on("annual", retention),
};

export const NAMES = Object.keys(CATALOGUE);
