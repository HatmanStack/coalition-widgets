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
  --chc-shadow: 0 1px 2px rgba(18,22,31,.05), 0 8px 24px -12px rgba(18,22,31,.12);
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
  --chc-shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px -12px rgba(0,0,0,.6);
}

* { box-sizing: border-box; margin: 0; padding: 0; }

.card {
  background: var(--chc-surface);
  border: 1px solid var(--chc-border);
  border-radius: 10px;
  box-shadow: var(--chc-shadow);
  padding: 1.15em 1.3em 1.3em;
  display: flex;
  flex-direction: column;
  gap: calc(.85rem * var(--chc-scale));
  /* em, not rem, so the partner's own type scale reaches the card.
     :host inherits font-size correctly, and this line then threw it away: a partner whose
     article body is 14px and one whose body is 20px both got 18.4px of card text, because a
     rem clamp measures the document root rather than the context the widget was dropped into.
     The rem ceiling stays as an absolute cap, so an unusually large host size cannot run away
     with the layout. */
  font-size: calc(min(clamp(.88em, .82em + .4cqi, 1.02em), 1.45rem) * var(--chc-scale));
  line-height: 1.55;
}

/* Provenance, at the foot with the attribution rather than above the title.
 *
 * It used to lead every card as ANNUAL · AS OF 2026-01-29T23:59:59Z — a cadence label nobody
 * outside this repo uses and a machine timestamp to the second, in monospace caps, as the first
 * thing read. It said less than it cost: what a reader needs is when the figure is from, which
 * is one short phrase, and it belongs next to who it came from. */
.card-foot {
  padding-top: calc(.15rem * var(--chc-scale));
  display: flex;
  flex-wrap: wrap;
  gap: .1rem .8rem;
  justify-content: space-between;
  align-items: baseline;
}
.period {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .72em;
  color: var(--chc-muted);
  /* Deliberately wrapping. This was nowrap when a period was the four words on one card; the
     pane footer now joins one phrase per cadence, which at 240px is far wider than the pane and
     pushed a horizontal scrollbar onto the partner's page. */
  overflow-wrap: anywhere;
}
h3 { font-size: clamp(1.05em, 1em + .5cqi, 1.3em); letter-spacing: -.02em; }
/* A sub-heading inside a card that carries more than one thing, like the queue: the headline
   count, then how many are in each group, then how long. Smaller than the card's own title so
   the hierarchy stays one level deep. */
h4.sub { font-size: .88em; font-weight: 600; color: var(--chc-ink-2); margin-top: .2em; }
.note { font-size: .875em; color: var(--chc-ink-2); }
.src { font-family: ui-monospace, Menlo, monospace; font-size: .72em; color: var(--chc-muted); }

.figure { font-size: calc(clamp(2rem, 1.2rem + 6cqi, 4rem) * var(--chc-scale)); font-weight: 700; line-height: .92; letter-spacing: -.04em; }
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
/* The tag's own settings, for the photograph. Small and quiet — it is for a machine reading the
   image, not for the reader of the page. */
.err .config {
  font-family: ui-monospace, Menlo, monospace;
  font-size: .72em;
  color: var(--chc-muted);
  overflow-wrap: anywhere;
}
/* The docs URL is one long unbreakable token, and an error card is the one card guaranteed to
   appear in a space too small for it — CHC-06 exists precisely because the container is narrow.
   Without this the too-narrow notice overflowed its own card, which is the worst place to have
   an overflow because it is what somebody photographs to ask for help. */
.err a, .err .detail { overflow-wrap: anywhere; }

.stale { font-size: .78em; color: var(--chc-s2); }

/* Skeletons. Reserving height is the job; the shimmer is just so it does not read as broken. */
.sk { gap: .7em; }
.sk-bar { background: var(--chc-surface-2); border-radius: 4px; height: 1em; }
.sk-title { width: 60%; height: 1.3em; }
.sk-body { background: var(--chc-surface-2); border-radius: 6px; height: calc(var(--sk-rows) * 1.55em); }
.sk-foot { width: 45%; height: .8em; }
.sk-bar, .sk-body { animation: sk 1.4s ease-in-out infinite; }
@keyframes sk { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
@media (prefers-reduced-motion: reduce) { .sk-bar, .sk-body { animation: none; } }

/* ---- the pane ---------------------------------------------------------------------------
 *
 * One script tag is one pane, and every widget it names is a card inside it. This used to be a
 * container in the LIGHT dom while its rules lived here in the shadow sheet, so none of them
 * ever applied and eleven widgets rendered as eleven separate shadow roots stacked by default
 * block layout. One root for the pane puts the grid where the sheet reaches.
 *
 * 300px minimum, matching the reference design: two or three cards across a page, each one
 * generous enough to carry a chart, an interpretation and its own attribution. An earlier pass
 * tried dense 190px tiles with figures packed several to a row; that is a different product.
 * Each statistic gets its own card. */
.pane {
  display: grid;
  gap: calc(1rem * var(--chc-scale));
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  /* dense lets a later short card back-fill a hole an earlier wide one left, so the pane packs
     instead of leaving a column empty. Reading order still follows the order the partner listed
     the widgets in, except where a gap would otherwise sit.

     Cards take their content height. Stretching them to share a row height looked tidier along
     the bottom edge, but it put the empty space INSIDE the card — a short stat beside a tall
     chart got several hundred pixels of nothing between its label and its source line, and
     opening a table view added to a card that already looked broken. A ragged bottom edge reads
     as a wall of cards; a card with a hole in it reads as a bug.

     Masonry would give both. grid-template-rows: masonry is not Baseline, and CSS columns would
     reorder the widgets down each column rather than across, which contradicts the order the
     partner asked for. */
  grid-auto-flow: dense;
  align-items: start;
}
/* Each tile is its own query container.
 *
 * container-type was only on :host, so every cqi inside a card resolved against the whole
 * pane. In a 1000px pane the cards are ~320px, and the headline figure was being sized from
 * 1000 — 104px of type in a 265px box, so "38,400" overflowed its own card. The card-level
 * breakpoints had the same fault in reverse: .bar-track { display: none } below 340px was
 * asking about the pane, so a 320px card in a wide pane kept a bar it had no room for.
 *
 * A container is a container for its DESCENDANTS, not for itself, so the pane-level span rules
 * below still resolve against :host. Only what is inside a card changes meaning, which is
 * exactly the set of things that should have been asking about the card all along. */
.tile { min-width: 0; display: flex; container-type: inline-size; }
.tile > * { width: 100%; }

/* The composite is a whole dashboard in one card, so it takes the row. */
.tile.full { grid-column: 1 / -1; }

/* ---- data-layout="dashboard" -------------------------------------------------------------
 *
 * The other path. Everything above builds the card layout: 300px tracks, a card per statistic,
 * each one carrying its own period, callout and attribution — a partner telling a story down a
 * page. This builds the dense one: narrow tracks, figures packed several across, spans so a
 * chart can sit beside four stats, and attribution once at the foot.
 *
 * Both are wanted, so neither is the "right" one. A partner dropping three widgets into a blog
 * post wants cards. A coalition putting all eleven on an internal wallboard wants this. */
.pane.dense {
  gap: calc(.9rem * var(--chc-scale));
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 190px), 1fr));
}
.pane.dense .tile.stat { grid-column: span 1; }
.pane.dense .tile.hero { grid-column: span 2; }
.pane.dense .tile.half { grid-column: span 2; }
.pane.dense .tile.wide { grid-column: span 3; }

/* Spans have to give way before the tracks get too thin to read, and a span cannot be clamped in
   CSS, so the container decides. */
@container (max-width: 720px) { .pane.dense .tile.wide { grid-column: 1 / -1; } }
@container (max-width: 560px) { .pane.dense .tile.half, .pane.dense .tile.hero { grid-column: 1 / -1; } }
@container (max-width: 420px) { .pane.dense .tile { grid-column: 1 / -1; } }

/* A dense stat is a figure and its caption and nothing else. The period and source lines repeat
   identically across a wallboard, so they move to the foot of the pane. */
/* A figure and its caption centre together, wherever they appear on a dense pane.
   Centring was on the stat and hero tiles only, so the comparison and retention figures stayed
   left while the ones beside them were centred. And the caption kept its 28ch measure without
   being centred as a block, so on a hero tile the text was centred inside a box that was itself
   sitting against the left edge — a number over a caption that did not line up with it.
   The measure is worth keeping; it is the block that needed centring, not the text alone. */
.pane.dense .figure,
.pane.dense .figure-label { text-align: center; }
.pane.dense .figure-label { margin-inline: auto; }

.pane.dense .tile.stat .card { justify-content: center; }
.pane.dense .tile.stat .figure { font-size: calc(clamp(1.6rem, 1.1rem + 3.4cqi, 2.6rem) * var(--chc-scale)); }
.pane.dense .tile.stat .figure-label { font-size: .8em; max-width: none; }
.pane.dense .tile.hero .figure { font-size: calc(clamp(2.6rem, 1.4rem + 5.2cqi, 4.4rem) * var(--chc-scale)); }

/* Headings, legends, the table toggle and the pane footer follow the numbers rather than
   sitting off to one side. Prose does not: a note and a callout stay left, because centred
   running text is measurably harder to read and the callout is a paragraph, not a caption. */
.pane.dense h3 { text-align: center; }
.pane.dense .legend { justify-content: center; }
/* Left, even in the dense layout where headings and figures centre. It is a control, not a
   caption — the pointer has to land somewhere predictable, and a centred label under a chart
   reads as another caption rather than as something to click. */
.pane.dense details > summary { text-align: left; }
.pane.dense .pane-foot { justify-content: center; text-align: center; }

/* Figures sharing one card, the shape the reference dashboard uses for "Youth Summary" and
   "Older Adults" — several numbers under one heading rather than one card each. */
.group { display: grid; gap: calc(.75rem * var(--chc-scale)); grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); }
.group .cell { text-align: center; }
.group .cell .n { font-size: calc(clamp(1.4rem, 1rem + 2.4cqi, 2.1rem) * var(--chc-scale)); font-weight: 700; line-height: 1; letter-spacing: -.03em; }
.group .cell .k { font-size: .78em; color: var(--chc-ink-2); line-height: 1.3; margin-top: .3rem; }

/* Said once, at the foot. */
.pane-foot { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: .25rem 1rem; justify-content: space-between; align-items: baseline; }
.pane-foot .src, .pane-foot .period { font-size: .72em; }

/* The element that makes these read as a story rather than a chart dump: a tinted box holding
   the sentence a reader should leave with, and the paragraph that qualifies it. */
.callout {
  background: var(--chc-surface-2);
  border-radius: 8px;
  padding: calc(1rem * var(--chc-scale)) calc(1.15rem * var(--chc-scale));
  display: flex;
  flex-direction: column;
  gap: .3rem;
}
.callout .big {
  font-size: calc(clamp(1.25rem, 1.1rem + .7cqi, 1.75rem) * var(--chc-scale));
  font-weight: 700;
  letter-spacing: -.03em;
  line-height: 1.15;
}
.callout .cl { font-size: .8em; color: var(--chc-ink-2); line-height: 1.55; }

@container (max-width: 340px) {
  .card { padding: .9rem; }
  .bar-row { grid-template-columns: 1fr auto; }
  .bar-row .cat { text-align: left; }
  .bar-track { display: none; }
  /* With the tracks gone the bars are already a two-column table of labels and numbers, so the
     table view under them offers the same thing twice. Only for bar cards: a column chart or a
     stacked bar is still a chart at this width and its table still adds something. */
  .card:has(.bars) > details { display: none; }
}

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
