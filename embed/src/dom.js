/* Element helpers, and the shared card skeleton every widget renders into.
 *
 * The skeleton is the contract: period, title, the form, legend, table view, note, source. A
 * widget that cannot fill the period line is not ready to publish, because two widgets side by
 * side showing different denominators with no dates on them is the exact defect this project
 * exists to fix. */

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

export const fmt = (n) => Number(n).toLocaleString("en-US");

/* "2026-01-29T23:59:59Z" -> "29 January 2026".
 *
 * The published as-of is an instant because the publisher refuses to invent precision it was
 * not given. A reader does not need the seconds, and printing them raised a question the figure
 * cannot answer — nothing here changes between 23:59:58 and 23:59:59. */
export function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/* The card skeleton: period, title, the form, legend, callout, table view, note, source.
 *
 * `callout` is the element that makes a card a story rather than a chart — the sentence a reader
 * should leave with, and the paragraph that qualifies it. A card with a figure and no callout is
 * showing a number without saying what it means.
 *
 * `source` is per card, not per pane. An earlier pass hoisted it to the foot of the pane to cut
 * repetition; the reference keeps it on each card, because a card is a thing a partner might
 * embed on its own and attribution has to travel with it. */
export function card({ title, body, legend, callout, table, note, stale }) {
  const root = el("div", "card");
  if (stale) root.appendChild(el("p", "stale", stale));
  if (title) root.appendChild(el("h3", null, title));
  for (const node of [].concat(body || [])) if (node) root.appendChild(node);
  if (legend) root.appendChild(legend);
  if (callout) root.appendChild(calloutBox(callout));
  if (table) {
    const details = el("details");
    details.appendChild(el("summary", null, "Table view"));
    const wrap = el("div", "tablewrap");
    wrap.appendChild(table);
    details.appendChild(wrap);
    root.appendChild(details);
  }
  if (note) root.appendChild(el("p", "note", note));
  return root;
}

export function calloutBox({ big, small }) {
  const box = el("div", "callout");
  if (big) box.appendChild(el("p", "big", big));
  if (small) box.appendChild(el("p", "cl", small));
  return box;
}

/* A single figure at tile density: the number and its caption, and nothing else. Where `card`
   builds an object that explains itself, this builds one cell of something larger. */
export function stat({ value, label, stale }) {
  const root = el("div", "card");
  if (stale) root.appendChild(el("p", "stale", stale));
  root.appendChild(el("div", "figure", fmt(value)));
  root.appendChild(el("p", "figure-label", label));
  return root;
}

/* Several figures under one heading, sharing a border — the shape "Youth Summary" and "Older
   Adults/Seniors Summary" take in the reference, where three numbers occupy one tile rather
   than three. */
export function group({ title, cells, period, stale }) {
  const root = el("div", "card");
  if (stale) root.appendChild(el("p", "stale", stale));
  if (period) root.appendChild(el("p", "period", period));
  if (title) root.appendChild(el("h3", null, title));
  const grid = el("div", "group");
  for (const [label, value] of cells) {
    const cell = el("div", "cell");
    cell.appendChild(el("div", "n", fmt(value)));
    cell.appendChild(el("div", "k", label));
    grid.appendChild(cell);
  }
  root.appendChild(grid);
  return root;
}

/* One footer for the pane, naming every cadence it is actually showing.
 *
 * Provenance used to sit on each card: a date under every one, repeating identically wherever
 * two cards shared a cadence, and — worse — reading as though each card were independently
 * dated when three cards from three cadences sat in a row. That is the composition the old
 * dashboard got wrong, four denominators presented as one population, and per-card grey text
 * was not doing enough to prevent it.
 *
 * Here the periods are stated once, together, so a reader sees at a glance that a pane holds a
 * March figure beside a January one. */
export function paneFoot(periods, source) {
  const foot = el("div", "pane-foot");
  if (periods.length) {
    foot.appendChild(el("span", "period", periods.join("  ·  ")));
  }
  foot.appendChild(el("span", "src", source));
  return foot;
}

/* A placeholder with roughly the shape and height of the card that will replace it.
 *
 * The point is not that a wait looks nicer. The pane had no height until its data arrived, so
 * the widget landed on a partner's page as a jump: everything below it moved down by however
 * tall the cards turned out to be. Measured on a five-widget pane that is a layout shift of
 * 0.19, where Google's threshold for "good" is 0.1 — a Core Web Vitals cost we impose on
 * somebody else's site, and worse on a real connection than on localhost.
 *
 * `rows` is the widget's nominal content height in lines. It only has to be close; a skeleton
 * within a line or two of the real card removes nearly all of the shift, and no skeleton can
 * remove all of it while the content depends on data nobody has yet. */
export function skeletonCard({ rows = 4, title = true }) {
  const root = el("div", "card sk");
  root.setAttribute("aria-hidden", "true");
  if (title) root.appendChild(el("div", "sk-bar sk-title"));
  const body = el("div", "sk-body");
  body.style.setProperty("--sk-rows", rows);
  root.appendChild(body);
  root.appendChild(el("div", "sk-bar sk-foot"));
  return root;
}

/* `config` is what the script tag actually passed, echoed back onto the card.
 *
 * The support path is a photograph handed to a model along with the documentation. The code and
 * the detail tell it what is wrong and what the valid values are, and the generated docs carry
 * the current bundle URL — but none of that says which widgets the partner asked for or what
 * else they set. Without it the best answer possible is "change data-size to md", which leaves a
 * non-technical person hunting for their tag to edit one attribute inside it.
 *
 * With the configuration in the picture, the screenshot is self-contained and the answer can be
 * a finished tag. It is the partner's own settings on their own page, and it only appears when
 * something is already wrong. */
export function errorCard({ code, detail, docs, config }) {
  const root = el("div", "card");
  const box = el("div", "err");
  box.appendChild(el("span", "code", code));
  box.appendChild(el("span", "detail", detail));
  if (config) box.appendChild(el("span", "config", config));
  const link = el("a", null, docs);
  link.href = docs;
  link.rel = "noopener noreferrer";
  box.appendChild(link);
  root.appendChild(box);
  return root;
}

export function table(headers, rows) {
  const t = el("table");
  const head = el("tr");
  headers.forEach((h) => head.appendChild(el("th", null, h)));
  t.appendChild(head);
  rows.forEach((cells) => {
    const tr = el("tr");
    cells.forEach((c, i) =>
      tr.appendChild(el("td", i ? "n" : null, i ? fmt(c) : c)),
    );
    t.appendChild(tr);
  });
  return t;
}

export function legendOf(items) {
  const wrap = el("div", "legend");
  items.forEach(([label, color]) => {
    const item = el("span", "item");
    const sw = el("span", "swatch");
    sw.style.background = color;
    item.appendChild(sw);
    item.appendChild(document.createTextNode(label));
    wrap.appendChild(item);
  });
  return wrap;
}
