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

export function card({ period, title, body, legend, table, note, source, stale }) {
  const root = el("div", "card");
  if (stale) root.appendChild(el("p", "stale", stale));
  if (period) root.appendChild(el("p", "period", period));
  if (title) root.appendChild(el("h3", null, title));
  for (const node of [].concat(body || [])) if (node) root.appendChild(node);
  if (legend) root.appendChild(legend);
  if (table) {
    const details = el("details");
    details.appendChild(el("summary", null, "Table view"));
    const wrap = el("div", "tablewrap");
    wrap.appendChild(table);
    details.appendChild(wrap);
    root.appendChild(details);
  }
  if (note) root.appendChild(el("p", "note", note));
  if (source) root.appendChild(el("p", "src", source));
  return root;
}

export function errorCard({ code, detail, docs }) {
  const root = el("div", "card");
  const box = el("div", "err");
  box.appendChild(el("span", "code", code));
  box.appendChild(el("span", "detail", detail));
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
    cells.forEach((c, i) => tr.appendChild(el("td", i ? "n" : null, i ? fmt(c) : c)));
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
