/* What the widget can work out about where it landed, without being told.
 *
 * Theme is measured, not declared. `auto` must not mean `prefers-color-scheme`: a partner with a
 * dark page and a system set to light would get a widget that fits nothing. Composite the
 * backgrounds of the composed ancestors until they add up to opaque, fill any remainder with the
 * browser's own canvas, and pick from the relative luminance of the result.
 *
 * What this cannot see is a background *image* or a gradient — computed style reports those as
 * a transparent colour, so a card on a hero photo composites through to whatever is behind it.
 * Reading the pixels would need canvas, and a partner's imagery is almost never CORS-clean, so
 * there is no version of this that closes the gap. `data-theme="light|dark"` is the answer, and
 * the README says so under the symptom rather than under an error code, because nothing here
 * fails — it just looks wrong. */

/* Where a background stops counting as light.
 *
 * 0.179 is the relative luminance at which white and black text carry equal contrast, so it is
 * the point a background genuinely changes sides rather than a number picked to feel right.
 *
 * It was 0.5, which is about #BCBCBC — a light grey. Everything below that was called dark, so
 * a #AAAAAA section or a 50% black scrim over a white page got a dark widget while reading as
 * mid-grey to anyone looking at it. */
const DARK_BELOW = 0.179;

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/* [r, g, b, alpha], or null for a colour that paints nothing. */
function parse(color) {
  const m = color && color.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
  const alpha = parts.length >= 4 ? parts[3] : 1;
  if (!(alpha > 0)) return null;
  return [parts[0], parts[1], parts[2], alpha];
}

const ua = () =>
  matchMedia("(prefers-color-scheme: dark)").matches
    ? [18, 18, 18]
    : [255, 255, 255];

export function resolveTheme(host) {
  /* Composite the stack rather than stopping at the first colour with any alpha.
   *
   * The first version took any background whose alpha was not exactly zero and treated it as
   * opaque, so `rgba(0,0,0,.5)` over a white page resolved as pure black and the widget came
   * out dark on what renders as mid-grey. Semi-transparent scrims over hero sections are common
   * enough that this was a real mismatch rather than a corner case.
   *
   * Layers accumulate from the widget outwards until they add up to opaque; whatever alpha is
   * left over at the top of the document is filled by the UA canvas. */
  let node = host;
  let r = 0;
  let g = 0;
  let b = 0;
  let left = 1;

  while (node && left > 0.004) {
    const c = parse(getComputedStyle(node).backgroundColor);
    if (c) {
      const share = c[3] * left;
      r += c[0] * share;
      g += c[1] * share;
      b += c[2] * share;
      left -= share;
    }
    if (node === document.documentElement) break;
    node = node.parentElement || (node.getRootNode() || {}).host;
  }

  if (left > 0.004) {
    // Nothing in the ancestry ever became opaque: the page leaves the canvas to the browser, or
    // paints it with an image or a gradient that computed style does not expose as a colour.
    const [ur, ug, ub] = ua();
    r += ur * left;
    g += ug * left;
    b += ub * left;
  }

  return luminance([r, g, b]) < DARK_BELOW ? "dark" : "light";
}

/* Re-resolve when the page changes theme.
 *
 * This watched <html> and <body> and nothing else, on the assumption that a dark-mode toggle
 * always lands on one of them. Plenty of sites put the class on a layout wrapper instead, and
 * for those the widget kept whatever it resolved at mount while everything around it changed.
 *
 * The whole ancestor chain is what decides the answer — resolveTheme reads every one of them —
 * so the chain is what gets watched. It is bounded by the depth of the host, a handful of
 * elements, and the callback is debounced because a theme switch usually touches several at
 * once. */
const THEME_ATTRS = [
  "class",
  "style",
  "data-theme",
  "data-color-scheme",
  "theme",
];

export function watchTheme(host, onChange) {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const fire = () => onChange();
  mq.addEventListener("change", fire);

  let pending = null;
  const observer = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(fire, 120);
  });

  const seen = new Set();
  const watch = (node) => {
    if (!node || node.nodeType !== 1 || seen.has(node)) return;
    seen.add(node);
    observer.observe(node, { attributes: true, attributeFilter: THEME_ATTRS });
  };

  let node = host;
  while (node) {
    watch(node);
    if (node === document.documentElement) break;
    node = node.parentElement || (node.getRootNode() || {}).host;
  }
  watch(document.documentElement);
  watch(document.body);

  return () => {
    mq.removeEventListener("change", fire);
    observer.disconnect();
    clearTimeout(pending);
  };
}

const STEPS = [
  [300, "xs", 0.8],
  [420, "sm", 0.9],
  [700, "md", 1.0],
  [1000, "lg", 1.15],
  [Infinity, "xl", 1.3],
];

export function sizeFor(width) {
  for (const [max, name, scale] of STEPS)
    if (width < max) return { name, scale };
  return { name: "xl", scale: 1.3 };
}

export function watchWidth(host, onChange) {
  const observer = new ResizeObserver((entries) => {
    for (const e of entries) onChange(e.contentRect.width);
  });
  observer.observe(host);
  return () => observer.disconnect();
}
