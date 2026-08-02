/* The four forms every widget is built from. Geometry is computed from the data, never typed.
 *
 * Bars cap at 24px and stay square at the axis. Stacked segments subtract the 2px gap from
 * their own height so the bar still sums to exactly 100% of its track, which is the detail that
 * drifts first when geometry is written by hand. */

import { el, fmt } from "./dom.js";

const GAP = 2;

export function bars(items, { color = "var(--chc-s1)", unknown = "var(--chc-unknown)" } = {}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const wrap = el("div", "bars");
  for (const item of items) {
    const row = el("div", "bar-row");
    row.appendChild(el("span", "cat", item.label));
    const track = el("span", "bar-track");
    const fill = el("span", "bar-fill");
    fill.style.width = `${((item.value / max) * 100).toFixed(1)}%`;
    if (item.muted) fill.style.background = unknown;
    else fill.style.background = color;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el("span", "val", fmt(item.value)));
    wrap.appendChild(row);
  }
  return wrap;
}

export function stack(segments) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const wrap = el("div", "stack");
  segments.forEach((s) => {
    const span = el("span");
    // Subtract the gap from the segment, not from the track, so the bar still sums to 100%.
    span.style.width = `calc(${((s.value / total) * 100).toFixed(2)}% - ${GAP}px)`;
    span.style.background = s.color;
    wrap.appendChild(span);
  });
  return wrap;
}

export function columns(points, { stacked = null } = {}) {
  const values = points.map((p) => (p.value == null ? 0 : p.value));
  const max = Math.max(...values, 1);
  const cols = el("div", "cols");
  const axis = el("div", "axis");
  cols.style.gridTemplateColumns = `repeat(${points.length}, 1fr)`;
  axis.style.gridTemplateColumns = `repeat(${points.length}, 1fr)`;

  for (const point of points) {
    const col = el("div", "col");
    col.appendChild(el("span", "cap", point.value == null ? " " : fmt(point.value)));
    const plot = el("span", "plot");
    if (point.value == null) {
      // A missing period is a labelled empty slot, never a short bar. A short bar reads as a
      // small number rather than as no number.
      plot.appendChild(el("span", "empty", "no data"));
    } else {
      // A point can carry a total without its components, which is not the same as no data.
      // Drawing it as a stacked stem gave a column of zero-height segments: the caption said
      // 690 and the chart showed nothing at all, which reads as a missing year rather than as
      // a year whose split was never published. Solid stem, and the table view still says the
      // components are absent.
      const split = stacked && stacked.every((part) => point[part.key] != null);
      const stem = el("span", split ? "stem stacked" : "stem");
      stem.style.height = `${((point.value / max) * 100).toFixed(1)}%`;
      if (split) {
        for (const part of stacked) {
          const seg = el("span");
          const share = (point[part.key] || 0) / (point.value || 1);
          seg.style.height = `calc(${(share * 100).toFixed(1)}% - 1px)`;
          seg.style.background = part.color;
          stem.appendChild(seg);
        }
      }
      plot.appendChild(stem);
    }
    col.appendChild(plot);
    cols.appendChild(col);
    axis.appendChild(el("span", null, point.label));
  }
  return [cols, axis];
}
