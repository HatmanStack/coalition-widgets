/* The catalogue. Each widget is a pure function of (payload, options) returning a node, plus the
 * cadence file it reads. Adding one means adding a row here. */

import { card, el, fmt, legendOf, table } from "../dom.js";
import { bars, columns, stack } from "../chart.js";
import { noData } from "../errors.js";

const S1 = "var(--chc-s1)";
const S2 = "var(--chc-s2)";
const S3 = "var(--chc-s3)";
const UNK = "var(--chc-unknown)";

const period = (asOf, cadence) => `${cadence} · as of ${asOf}`;
const SOURCE = "Source: Coalition HMIS via Looker. Unaffiliated concept, not endorsed.";

function figure(value, label, delta) {
  const nodes = [el("div", "figure", fmt(value)), el("p", "figure-label", label)];
  if (delta) nodes.push(el("p", "note", delta));
  return nodes;
}

/* ---- measure widgets ---- */

function measureWidget(id, label) {
  return {
    cadence: (payload) => payload.meta.cadence,
    needs: `measures.${id}`,
    render(payload, { stale, variant }) {
      const m = payload.measures && payload.measures[id];
      if (!m) return noData(id, `measures.${id}`);
      return card({
        stale,
        period: period(m.asOf, m.cadence),
        body: figure(m.value, label),
        source: variant === "figure-only" ? null : SOURCE,
      });
    },
  };
}

/* ---- breakdown widgets ---- */

function breakdownWidget(id, title, form) {
  return {
    needs: `breakdowns.${id}`,
    render(payload, { stale, showTable }) {
      const b = payload.breakdowns && payload.breakdowns[id];
      if (!b) return noData(id, `breakdowns.${id}`);

      const items = b.categories.map((c) => ({ label: c.label, value: c.value }));
      if (b.residual) items.push({ label: b.residual.label, value: b.residual.value, muted: true });

      const rows = items.map((i) => [i.label, i.value]);
      const total = items.reduce((a, i) => a + i.value, 0);
      rows.push(["Total", total]);

      let body, legend = null;
      if (form === "stack") {
        const colors = [S1, S2, S3, UNK];
        body = [stack(items.map((i, n) => ({ value: i.value, color: colors[Math.min(n, 3)] })))];
        legend = legendOf(items.map((i, n) => [`${i.label} ${fmt(i.value)}`, colors[Math.min(n, 3)]]));
      } else {
        body = [bars(items)];
      }

      return card({
        stale,
        period: period(b.asOf, b.cadence),
        title,
        body,
        legend,
        table: showTable ? table(["Category", "People"], rows) : null,
        note:
          total === b.universe
            ? null
            : `These categories sum to ${fmt(total)} against a stated population of ${fmt(b.universe)}.`,
        source: SOURCE,
      });
    },
  };
}


/* ---- series and comparison widgets ---- */

function seriesWidget(id, title, { stacked = null, note = null } = {}) {
  return {
    needs: `series.${id}`,
    render(payload, { stale, showTable, years }) {
      const series = payload.series && payload.series[id];
      if (!series) return noData(id, `series.${id}`);

      let points = series.points;
      // `data-years` takes the most recent N of the PUBLISHED span. It never invents slots
      // before the series began, and a gap inside the span stays a labelled empty slot.
      if (years && years > 0 && years < points.length) points = points.slice(-years);

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
        period: `${series.cadence} · ${points[0].label} to ${points[points.length - 1].label}`,
        title,
        body: [cols, axis],
        legend: stacked ? legendOf(stacked.map((p) => [p.label, p.color])) : null,
        table: showTable ? table(headers, rows) : null,
        note,
        source: SOURCE,
      });
    },
  };
}

function comparisonWidget(id, title, { unit = "", higherIsWorse = true } = {}) {
  return {
    needs: `comparisons.${id}`,
    render(payload, { stale, showTable }) {
      const c = payload.comparisons && payload.comparisons[id];
      if (!c) return noData(id, `comparisons.${id}`);

      const items = [
        { label: c.hereLabel, value: c.here },
        { label: c.thereLabel, value: c.there, muted: true },
      ];
      const gap = c.there - c.here;
      const better = higherIsWorse ? gap > 0 : gap < 0;

      return card({
        stale,
        period: `${c.cadence} · as of ${c.asOf}`,
        title,
        body: [
          ...figure(c.here, c.hereLabel),
          bars(items),
        ],
        table: showTable
          ? table(["", unit || "Value"], items.map((i) => [i.label, i.value]))
          : null,
        note: c.note || (better
          ? `${fmt(Math.abs(gap))} ${unit} better than the comparison.`
          : `${fmt(Math.abs(gap))} ${unit} worse than the comparison.`),
        source: SOURCE,
      });
    },
  };
}

/* ---- inflow against outflow, the functional zero measure ---- */

const inflowOutflow = {
  needs: "flows",
  render(payload, { stale, showTable, segment }) {
    const flows = payload.flows && payload.flows[segment && segment !== "all" ? segment : "all"];
    if (!flows) return noData("inflow-outflow", `flows.${segment || "all"}`);

    const items = [
      { label: "Became homeless", value: flows.in },
      { label: "Housed or exited", value: flows.out, muted: true },
    ];
    const net = flows.in - flows.out;

    return card({
      stale,
      period: `${flows.cadence} · as of ${flows.asOf}`,
      title: "Moving people out, against how many arrive",
      body: [bars(items), el("p", "note", net === 0
        ? "Inflow and outflow balanced."
        : net > 0
          ? `${fmt(net)} more people became homeless than left homelessness.`
          : `${fmt(Math.abs(net))} more people left homelessness than became homeless.`)],
      table: showTable ? table(["Direction", "People"], items.map((i) => [i.label, i.value])) : null,
      note: "This is the measure that says whether the work is succeeding.",
      source: SOURCE,
    });
  },
};

/* ---- a proportion, drawn as a meter ---- */

const retention = {
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
      period: `${r.cadence} · as of ${r.asOf}`,
      title: "Still housed two years on",
      body: [el("div", "figure", `${r.percent}%`), meter],
      note: r.note,
      source: SOURCE,
    });
  },
};

/* ---- the composite ---- */

const hmisSnapshot = {
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

    const grid = el("div", "bars");
    for (const [id, label] of tiles) {
      const row = el("div", "bar-row");
      row.appendChild(el("span", "cat", label));
      row.appendChild(el("span"));
      row.appendChild(el("span", "val", fmt(m[id].value)));
      grid.appendChild(row);
    }

    const body = [grid];
    for (const [id, title, form] of [
      ["raceEthnicity", "Race and ethnicity", "bars"],
      ["shelterStatus", "Where people are staying", "stack"],
    ]) {
      const b = payload.breakdowns && payload.breakdowns[id];
      if (!b) continue;
      body.push(el("h3", null, title));
      const items = b.categories.map((c) => ({ label: c.label, value: c.value }));
      if (b.residual) items.push({ label: b.residual.label, value: b.residual.value, muted: true });
      if (form === "stack") {
        const colors = [S1, S2, S3, UNK];
        body.push(stack(items.map((i, n) => ({ value: i.value, color: colors[Math.min(n, 3)] }))));
        body.push(legendOf(items.map((i, n) => [`${i.label} ${fmt(i.value)}`, colors[Math.min(n, 3)]])));
      } else {
        body.push(bars(items));
      }
    }

    const first = m[tiles[0][0]];
    return card({
      stale,
      period: period(first.asOf, first.cadence),
      title: "Homeless services dashboard",
      body,
      table: showTable
        ? table(["Measure", "Value"], tiles.map(([id, label]) => [label, m[id].value]))
        : null,
      note:
        "Counts anyone with a live enrolment on the last day of the period, each person once.",
      source: SOURCE,
    });
  },
};

const S1_ = "var(--chc-s1)";
const S2_ = "var(--chc-s2)";

export const CATALOGUE = {
  "hmis-snapshot": hmisSnapshot,
  "active-count": measureWidget("activelyHomeless", "people actively experiencing homelessness"),
  "queue-total": measureWidget("queueTotal", "people waiting for housing right now"),
  "race-ethnicity": breakdownWidget("raceEthnicity", "Race and ethnicity", "bars"),
  "shelter-status": breakdownWidget("shelterStatus", "Where people are staying", "stack"),
  "pit-trend": seriesWidget("pitCount", "The January census", {
    stacked: [
      { key: "sheltered", label: "Sheltered", color: S1_ },
      { key: "unsheltered", label: "Unsheltered", color: S2_ },
    ],
    note: "Counted on a single night in January. Colder weather pushes more people into shelter, so year on year change reflects conditions as well as counting.",
  }),
  "newly-homeless": seriesWidget("newlyHomeless", "Households becoming homeless each year"),
  "inflow-outflow": inflowOutflow,
  "alice-gap": comparisonWidget("aliceGap", "What a household needs against what it earns", {
    unit: "dollars a year",
    higherIsWorse: true,
  }),
  "length-of-stay": comparisonWidget("lengthOfStay", "Days spent homeless", {
    unit: "days",
    higherIsWorse: false,
  }),
  "retention": retention,
};

export const NAMES = Object.keys(CATALOGUE);
