/* What the widget can work out about where it landed, without being told.
 *
 * Theme is measured, not declared. `auto` must not mean `prefers-color-scheme`: a partner with a
 * dark page and a system set to light would get an unreadable widget. Walk up the composed
 * ancestors, take the first background with any opacity, compute relative luminance, and pick
 * from that. Fall back to the media query only when nothing opaque is found, which means the
 * page never set one. */

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parse(color) {
  const m = color && color.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(",").map((p) => parseFloat(p.trim()));
  if (parts.length >= 4 && parts[3] === 0) return null; // fully transparent, keep looking
  return parts.slice(0, 3);
}

export function resolveTheme(host) {
  let node = host;
  while (node && node !== document.documentElement) {
    const rgb = parse(getComputedStyle(node).backgroundColor);
    if (rgb) return luminance(rgb) < 0.5 ? "dark" : "light";
    node = node.parentElement || (node.getRootNode() || {}).host;
  }
  const root = parse(getComputedStyle(document.documentElement).backgroundColor);
  if (root) return luminance(root) < 0.5 ? "dark" : "light";
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/* Re-resolve when the page changes theme. Nearly every dark-mode toggle does it by putting a
   class or a data attribute on <html> or <body>, so watch both, plus the media query. */
export function watchTheme(onChange) {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const fire = () => onChange();
  mq.addEventListener("change", fire);

  let pending = null;
  const observer = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(fire, 120);
  });
  for (const target of [document.documentElement, document.body]) {
    if (target) observer.observe(target, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  }
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
  for (const [max, name, scale] of STEPS) if (width < max) return { name, scale };
  return { name: "xl", scale: 1.3 };
}

export function watchWidth(host, onChange) {
  const observer = new ResizeObserver((entries) => {
    for (const e of entries) onChange(e.contentRect.width);
  });
  observer.observe(host);
  return () => observer.disconnect();
}
