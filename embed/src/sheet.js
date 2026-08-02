/* The palette and layout, as one constructable stylesheet shared by every widget on the page.
 *
 * Built once and adopted by every shadow root, so N widgets cost one stylesheet rather than N
 * copies. `adoptedStyleSheets` is Baseline since March 2023; the `<style>` fallback exists
 * because a host page's `style-src` governs a `<style>` inside a shadow root, and whether it
 * governs CSSOM insertion is not something to assume. If the constructable path is blocked the
 * fallback still paints.
 *
 * Every breakpoint is a container query, never a media query. A widget in a 320px sidebar on a
 * 1440px desktop is narrow, and a media query says it is wide. That is the single most
 * consequential line in this file. */

const CSS = `
:host {
  display: block;
  container-type: inline-size;
  /* Inherit the host page's type. A partner running Palanquin gets Palanquin with no
     configuration and no font loading. */
  font-family: inherit;
  color: var(--chc-ink);
  --chc-scale: 1;
  --chc-plane: transparent;
  --chc-surface: #fafbfd;
  --chc-surface-2: #eef1f7;
  --chc-ink: #12161f;
  --chc-ink-2: #4a5265;
  --chc-muted: #767e90;
  --chc-grid: #e2e6ef;
  --chc-baseline: #c6ccda;
  --chc-border: rgba(18,22,31,.10);
  --chc-s1: #0044b5;
  --chc-s2: #eb6834;
  --chc-s3: #1baf7a;
  --chc-unknown: #b3bacb;
}
:host([data-chc-theme="dark"]) {
  --chc-surface: #12151c;
  --chc-surface-2: #1a1e27;
  --chc-ink: #ffffff;
  --chc-ink-2: #b4bccc;
  --chc-muted: #838b9c;
  --chc-grid: #232833;
  --chc-baseline: #333a47;
  --chc-border: rgba(255,255,255,.10);
  --chc-s1: #5082f0;
  --chc-s2: #d95926;
  --chc-s3: #199e70;
  --chc-unknown: #5c6478;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

.card {
  background: var(--chc-surface);
  border: 1px solid var(--chc-border);
  border-radius: 10px;
  padding: calc(1.15rem * var(--chc-scale)) calc(1.3rem * var(--chc-scale));
  display: flex;
  flex-direction: column;
  gap: calc(.85rem * var(--chc-scale));
  font-size: calc(clamp(.9375rem, .9rem + .4cqi, 1rem) * var(--chc-scale));
  line-height: 1.55;
}

.period {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: calc(clamp(.7rem, .68rem + .15cqi, .8125rem) * var(--chc-scale));
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--chc-muted);
}
h3 { font-size: calc(clamp(1rem, .95rem + .5cqi, 1.25rem) * var(--chc-scale)); letter-spacing: -.02em; }
.note { font-size: .875em; color: var(--chc-ink-2); }
.src { font-family: ui-monospace, Menlo, monospace; font-size: .72em; color: var(--chc-muted); }

.figure { font-size: calc(clamp(2.4rem, 1.6rem + 7cqi, 5rem) * var(--chc-scale)); font-weight: 700; line-height: .92; letter-spacing: -.04em; }
.figure-label { color: var(--chc-ink-2); max-width: 28ch; }

.bars { display: flex; flex-direction: column; gap: .5rem; }
.bar-row { display: grid; grid-template-columns: minmax(70px, 32%) 1fr auto; gap: .6rem; align-items: center; font-size: .875em; }
.bar-row .cat { color: var(--chc-ink-2); text-align: right; line-height: 1.25; }
.bar-track { height: min(18px, 1.4em); display: flex; align-items: center; }
.bar-fill { height: 100%; background: var(--chc-s1); border-radius: 0 4px 4px 0; min-width: 2px; }
.bar-row .val { font-variant-numeric: tabular-nums; font-weight: 600; text-align: right; }

.stack { display: flex; width: 100%; height: min(24px, 1.9em); gap: 2px; }
.stack > span { display: block; height: 100%; }
.stack > span:first-child { border-radius: 4px 0 0 4px; }
.stack > span:last-child { border-radius: 0 4px 4px 0; }

.cols { display: grid; gap: .5rem; height: calc(200px * var(--chc-scale)); }
.col { display: flex; flex-direction: column; align-items: center; gap: .35rem; height: 100%; justify-content: flex-end; }
.col .cap { font-size: .8em; font-weight: 700; font-variant-numeric: tabular-nums; }
.col .plot { flex: 1; width: 100%; display: flex; align-items: flex-end; justify-content: center; }
.stem { width: min(24px, 62%); background: var(--chc-s1); border-radius: 4px 4px 0 0; }
.stem.stacked { display: flex; flex-direction: column; gap: 2px; background: none; border-radius: 0; }
.stem.stacked > span { display: block; width: 100%; }
.stem.stacked > span:first-child { border-radius: 4px 4px 0 0; }
.axis { display: grid; gap: .5rem; border-top: 1px solid var(--chc-baseline); padding-top: .4rem; }
.axis span { text-align: center; font-size: .78em; color: var(--chc-muted); font-variant-numeric: tabular-nums; }
.empty { color: var(--chc-muted); font-size: .78em; text-align: center; }

.legend { display: flex; flex-wrap: wrap; gap: .4rem .9rem; font-size: .82em; color: var(--chc-ink-2); }
.legend .item { display: inline-flex; align-items: center; gap: .35rem; }
.swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }

table { border-collapse: collapse; width: 100%; font-size: .82em; }
th, td { text-align: left; padding: .35rem .6rem .35rem 0; border-bottom: 1px solid var(--chc-grid); }
th { color: var(--chc-muted); font-weight: 600; }
td.n { text-align: right; font-variant-numeric: tabular-nums; }
.tablewrap { overflow-x: auto; }
details > summary { cursor: pointer; font-size: .82em; color: var(--chc-ink-2); }

.err { border-left: 3px solid var(--chc-s2); padding-left: .8rem; display: flex; flex-direction: column; gap: .3rem; }
.err .code { font-family: ui-monospace, Menlo, monospace; font-weight: 700; font-size: .8em; }
.err .detail { font-size: .875em; color: var(--chc-ink-2); }
.err a { color: var(--chc-s1); font-size: .8em; }

.stale { font-size: .78em; color: var(--chc-s2); }

.stack-list { display: flex; flex-direction: column; gap: 1rem; }
@container (min-width: 700px) { .stack-list.cols-2 { display: grid; grid-template-columns: 1fr 1fr; } }
@container (max-width: 340px) { .card { padding: .9rem; } .bar-row { grid-template-columns: 1fr auto; } .bar-row .cat { text-align: left; } .bar-track { display: none; } }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
@media (forced-colors: active) { .bar-fill, .stack > span, .stem, .stem.stacked > span { forced-color-adjust: none; border: 1px solid ButtonText; } }
`;

let sheet = null;

export function adopt(root) {
  if (sheet === null && typeof CSSStyleSheet === "function") {
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
    } catch {
      sheet = false;
    }
  }
  if (sheet) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  }
  // A host CSP that blocks this blocks a <style> too, but a <style> is the wider-supported
  // path and costs one element per widget rather than failing to paint at all.
  const el = document.createElement("style");
  el.textContent = CSS;
  root.appendChild(el);
}
