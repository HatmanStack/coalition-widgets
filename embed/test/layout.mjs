/* How the layout reacts to the space it is given, and to what it is asked to show.
 *
 * A widget is embedded into somebody else's page, so neither of the two things that decide its
 * layout is under our control: the width of the container, and which widgets the partner
 * listed. This drives both together — every combination at every width — because the bugs live
 * in the interaction rather than in either axis alone.
 *
 * Both of the real faults found so far were exactly that shape and neither is visible from one
 * screenshot:
 *
 *   - `cqi` resolved against the pane while cards are pane/N wide, so a card overflowed only at
 *     the widths where the pane was wide AND the column count was high. It was fine at 300px
 *     and fine at 1400px, and broken at 1000.
 *   - The narrow-card breakpoints asked about the pane too, so a 320px card kept a bar it had
 *     no room for — but only when it sat in a wide pane.
 *
 *   node embed/test/layout.mjs
 *   node embed/test/layout.mjs --keep    leave the screenshots behind
 */

import { createServer } from "node:http";
import {
  readdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { chromium } from "playwright";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const PORT = 8131;
const ORIGIN = `http://localhost:${PORT}`;
const KEEP = process.argv.includes("--keep");
const MIN_WIDTH = 240; // must match boot.js

const dir = mkdtempSync(join(tmpdir(), "chc-layout-"));
let failures = 0;
const fail = (m) => {
  failures++;
  console.log(`  FAIL ${m}`);
};

/* Widths chosen at the boundaries the CSS actually names, plus one either side of each. A grid
   of round numbers would miss the transitions, which is where layout breaks. */
const WIDTHS = [239, 240, 300, 340, 420, 560, 620, 720, 1000, 1400, 1800];

/* Combinations that stress different things: one card alone, cards that must share a row, the
   full-span composite among others, the two that overflowed, and everything at once. */
const COMBOS = [
  { name: "composite-alone", widgets: "hmis-snapshot" },
  { name: "one-stat", widgets: "active-count" },
  { name: "two-stats", widgets: "active-count,queue-total" },
  { name: "stats-and-chart", widgets: "active-count,queue-total,pit-trend" },
  { name: "comparisons", widgets: "alice-gap,length-of-stay" },
  // Two cadences in one card, and the tallest thing on the catalogue.
  { name: "queue", widgets: "queue" },
  { name: "queue-and-county", widgets: "queue,county" },
  { name: "charts-only", widgets: "pit-trend,newly-homeless,race-ethnicity" },
  {
    name: "composite-plus",
    widgets: "hmis-snapshot,active-count,race-ethnicity",
  },
  {
    name: "all-eleven",
    widgets: [
      "hmis-snapshot",
      "active-count",
      "queue-total",
      "race-ethnicity",
      "shelter-status",
      "pit-trend",
      "newly-homeless",
      "inflow-outflow",
      "alice-gap",
      "length-of-stay",
      "retention",
    ].join(","),
  },
];

const LAYOUTS = ["cards", "dashboard"];

// ---- fixtures, published by the real publisher against the stub -----------------------------

console.log(`  building and publishing against ${ORIGIN}`);
const stub = execFileSync(
  "node",
  [join(ROOT, "scripts/looker-stub.mjs"), "--scenario=list"],
  {
    cwd: ROOT,
    encoding: "utf-8",
  },
);
void stub;

const stubProc = (await import("node:child_process")).spawn(
  "node",
  [join(ROOT, "scripts/looker-stub.mjs"), "--port=8231"],
  { cwd: ROOT, stdio: "ignore" },
);
await new Promise((r) => setTimeout(r, 700));
try {
  execFileSync("python3", [join(ROOT, "scripts/local-publish.py")], {
    cwd: ROOT,
    encoding: "utf-8",
    env: { ...process.env, LOOKER_STUB: "http://localhost:8231" },
  });
} finally {
  stubProc.kill();
}

execFileSync("node", [join(ROOT, "embed/build.mjs")], {
  cwd: ROOT,
  env: { ...process.env, DATA_ORIGIN: ORIGIN },
  stdio: "pipe",
});
const bundle = JSON.parse(
  readFileSync(join(ROOT, "dist/manifest.json"), "utf-8"),
).file;

mkdirSync(join(dir, "v1/data"), { recursive: true });
mkdirSync(join(dir, "v1"), { recursive: true });
/* Whatever was published, not a list of what used to be. Naming the cadences here meant adding
   one to the contract left this behind, and the widget that needed it 404'd inside the suite —
   which reported as a console error rather than as the missing fixture it was. */
for (const f of readdirSync(join(ROOT, "dist/v1/data"))) {
  writeFileSync(
    join(dir, "v1/data", f),
    readFileSync(join(ROOT, "dist/v1/data", f)),
  );
}
writeFileSync(
  join(dir, bundle),
  readFileSync(join(ROOT, "dist", bundle.split("/").pop())),
);

for (const layout of LAYOUTS) {
  for (const combo of COMBOS) {
    writeFileSync(
      join(dir, `${layout}-${combo.name}.html`),
      `<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#fff;font:16px system-ui">
<div id="w" style="width:1000px">
<script src="/${bundle}" defer data-target="#w" data-layout="${layout}"
        data-widgets="${combo.widgets}"></script>
</div></body>`,
    );
  }
}

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
};
const server = createServer((req, res) => {
  const path = join(dir, decodeURIComponent(req.url.split("?")[0]));
  let body;
  try {
    body = readFileSync(path);
  } catch {
    res.writeHead(404).end("no");
    return;
  }
  res
    .writeHead(200, {
      "content-type": TYPES[extname(path)] || "application/octet-stream",
      "access-control-allow-origin": "*",
    })
    .end(body);
});
await new Promise((r) => server.listen(PORT, r));

// ---- measure --------------------------------------------------------------------------------

/* Everything read out of one shadow root in one pass. Returned as data rather than asserted in
   the page, so a failure prints the numbers that produced it. */
const PROBE = (min) => {
  const host = [...document.querySelectorAll("#w div")].find(
    (d) => d.shadowRoot,
  );
  if (!host) return { error: "nothing mounted" };
  const sr = host.shadowRoot;
  const pane = sr.querySelector(".pane");
  if (!pane) return { error: "no pane" };

  const tiles = [...pane.querySelectorAll(".tile")];
  const cards = [];
  for (const tile of tiles) {
    const card = tile.querySelector(".card");
    if (!card) continue;
    const box = card.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const inner =
      box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);

    // Anything drawn wider than the space its card leaves it.
    const spills = [];
    for (const n of card.querySelectorAll("*")) {
      if (n.clientWidth === 0) continue;
      // A deliberate scroll container is not an overflow. `.tablewrap` sets overflow-x: auto so
      // a wide table scrolls inside the card rather than widening it — content wider than the
      // box is the entire point, and flagging it reported a working feature as a bug.
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden") continue;
      if (n.scrollWidth > Math.ceil(n.clientWidth) + 1) {
        spills.push(
          `${n.className || n.tagName}(${n.scrollWidth}>${n.clientWidth})`,
        );
      }
    }
    if (Math.ceil(card.scrollWidth) > Math.ceil(card.clientWidth) + 1) {
      spills.push(`card(${card.scrollWidth}>${card.clientWidth})`);
    }

    // Distance from the bottom of the last child to the card's inner bottom edge.
    const kids = [...card.children].filter(
      (n) => n.getBoundingClientRect().height > 0,
    );
    const lastBottom = kids.length
      ? Math.max(...kids.map((n) => n.getBoundingClientRect().bottom))
      : box.bottom;
    const slack = Math.round(
      box.bottom - parseFloat(cs.paddingBottom) - lastBottom,
    );

    cards.push({
      slack,
      top: Math.round(box.top),
      height: Math.round(box.height),
      width: Math.round(box.width),
      inner: Math.round(inner),
      code: card.querySelector(".code")?.textContent || null,
      spills,
    });
  }

  return {
    paneWidth: Math.round(pane.clientWidth),
    paneScroll: Math.round(pane.scrollWidth),
    tiles: tiles.length,
    cards,
    columns: new Set(cards.filter((c) => !c.code).map((c) => c.top)).size,
    tooNarrow: cards.filter((c) => c.code === "CHC-06").length,
    dataCards: cards.filter((c) => !c.code).length,
    min,
  };
};

const browser = await chromium.launch();
let checks = 0;

/* Combinations are independent — each is its own page against static files — so they run
   concurrently. Sequentially this was the whole remaining cost: setup is about a second, and
   everything else was sixteen combination runs waiting their turn.
   Results are collected rather than printed as they finish, because interleaved output from
   parallel work is unreadable and the order of the report should not depend on scheduling. */
const CONCURRENCY = 6;
const jobs = [];
for (const layout of LAYOUTS) for (const combo of COMBOS) jobs.push({ layout, combo });
const results = new Map();

async function runJob({ layout, combo }) {
  {
    const page = await browser.newPage({
      viewport: { width: 1900, height: 1000 },
    });
    const noise = [];
    page.on("console", (m) => m.type() === "error" && noise.push(m.text()));
    page.on("pageerror", (e) => noise.push(`UNCAUGHT: ${e.message}`));

    await page.goto(`${ORIGIN}/${layout}-${combo.name}.html`, {
      waitUntil: "networkidle",
    });
    // Wait for the widget to exist, not for a guess at how long mounting takes.
    await page.waitForFunction(() => {
      const host = [...document.querySelectorAll("#w div")].find((d) => d.shadowRoot);
      return !!host?.shadowRoot.querySelector(".card");
    });

    const bad = [];
    /* Both states. A card grows when its table view opens, and the dead-space bug was only
       visible once one was open — closed, the card looked plausible. Any assertion about how a
       card fills its space has to hold in the state a reader can put it in. */
    for (const tablesOpen of [false, true]) {
      await page.evaluate((open) => {
        const host = [...document.querySelectorAll("#w div")].find(
          (d) => d.shadowRoot,
        );
        host?.shadowRoot
          .querySelectorAll("details")
          .forEach((d) => (d.open = open));
      }, tablesOpen);

      for (const w of WIDTHS) {
        const tag = tablesOpen ? `${w}px table-open` : `${w}px`;
        /* Resize, then wait for the layout to have actually responded.
         *
         * This was a flat 180ms sleep per measurement, which was 63 of the suite's 86 seconds —
         * more than four fifths of the runtime spent waiting on a number picked to be safely
         * longer than a ResizeObserver takes. Waiting on the pane reaching the requested width
         * and then settling for two frames is both faster and stricter: a sleep that is too
         * short measures a stale layout and reports it as fact. */
        await page.evaluate(
          (px) => (document.querySelector("#w").style.width = px + "px"),
          w,
        );
        await page.waitForFunction((px) => {
          const host = [...document.querySelectorAll("#w div")].find((d) => d.shadowRoot);
          const pane = host?.shadowRoot.querySelector(".pane");
          return pane && Math.round(pane.getBoundingClientRect().width) === px;
        }, w);
        // The observer sets --chc-scale, which can reflow again; let both frames land.
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
        const r = await page.evaluate(PROBE, MIN_WIDTH);
        checks++;

        if (r.error) {
          bad.push(`${tag}: ${r.error}`);
          continue;
        }

        // 1. Nothing is drawn wider than the box it is in.
        for (const c of r.cards) {
          if (c.spills.length)
            bad.push(`${tag}: card ${c.width}px spills ${c.spills.join(" ")}`);
        }

        // 2. The pane itself never scrolls sideways. A partner's page must not gain a scrollbar
        //    because of an embed.
        if (r.paneScroll > r.paneWidth + 1) {
          bad.push(`${tag}: pane scrolls ${r.paneScroll}>${r.paneWidth}`);
        }

        // 3. Below the floor it refuses, and refuses instead of rendering — not as well as.
        if (w < MIN_WIDTH) {
          if (!r.tooNarrow) bad.push(`${tag}: below the floor and no CHC-06`);
          if (r.dataCards)
            bad.push(
              `${tag}: below the floor but rendered ${r.dataCards} cards`,
            );
        } else if (r.tooNarrow) {
          bad.push(`${tag}: at or above the floor but refused as too narrow`);
        }

        // 4. No card carries dead space. Cards take their content height, so the gap between
        //    the last thing drawn and the inner bottom edge should be nothing. Stretching cards
        //    to a shared row height moved the empty space INSIDE the short ones — a stat beside
        //    a chart had hundreds of pixels between its label and its source line.
        for (const c of r.cards) {
          if (c.slack > 24) {
            bad.push(
              `${tag}: ${c.width}px card has ${c.slack}px of dead space`,
            );
          }
        }


        // 5. One column once there is only room for one, and more than one once there is room.
        //    Catches a track definition that stops responding.
        // Cards only. In the dense layout a card may ask for three tracks, so two of them
        // genuinely cannot share a 5-track row — stacking there is the span system working, not
        // a track definition that stopped responding.
        if (layout === "cards" && w >= MIN_WIDTH && r.dataCards > 1) {
          const perRow = {};
          for (const c of r.cards.filter((x) => !x.code))
            perRow[c.top] = (perRow[c.top] || 0) + 1;
          const widest = Math.max(...Object.values(perRow));
          if (w < 560 && widest > 1)
            bad.push(`${tag}: ${widest} cards in a row below 560px`);
          if (w >= 1000 && widest < 2 && r.dataCards >= 3) {
            bad.push(
              `${w}px: still one column at ${w}px with ${r.dataCards} cards`,
            );
          }
        }
      }
    }

    if (noise.length)
      bad.push(`console: ${[...new Set(noise)].slice(0, 2).join(" | ")}`);

    results.set(`${layout}/${combo.name}`, bad);
    if (bad.length && KEEP) {
      await page.screenshot({
        path: join(dir, `${layout}-${combo.name}.png`),
        fullPage: true,
      });
    }
    await page.close();
  }
}

// A fixed pool of workers pulling from one queue, so a slow combination does not hold up a
// batch behind it.
const queue = jobs.slice();
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await runJob(job);
  }),
);

for (const layout of LAYOUTS) {
  console.log(`\n--- data-layout="${layout}" ---`);
  for (const combo of COMBOS) {
    const bad = results.get(`${layout}/${combo.name}`) || ["did not run"];
    if (bad.length) {
      fail(combo.name);
      for (const b of bad.slice(0, 6)) console.log(`       ${b}`);
      if (bad.length > 6) console.log(`       …and ${bad.length - 6} more`);
    } else {
      console.log(`  ok   ${combo.name.padEnd(18)} ${WIDTHS.length} widths`);
    }
  }
}

await browser.close();
server.close();
if (KEEP) console.log(`\nkept: ${dir}`);
else rmSync(dir, { recursive: true, force: true });

console.log(
  `\n${checks} measurements across ${LAYOUTS.length} layouts × ${COMBOS.length} combinations × ${WIDTHS.length} widths`,
);
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
