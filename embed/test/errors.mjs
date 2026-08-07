/* Every way a script tag can be wrong, rendered in a real browser and read back out of the
 * shadow roots.
 *
 * The support path is a partner photographing the widget and handing the photo to an assistant
 * along with the README, so what this asserts is not "an error happened" but **which** card
 * appeared and **that its text contains the values that would have worked**. A rig that only
 * checked for the presence of an error would pass with every message replaced by the same one,
 * which is exactly the failure that makes the screenshot useless.
 *
 *   node embed/test/errors.mjs          # headless, exits non-zero on failure
 *   node embed/test/errors.mjs --keep   # leaves the screenshots and serve dir for inspection
 */

import { createServer } from "node:http";
import {
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
import { ALLOWED } from "../src/params.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = 8129;
const ORIGIN = `http://localhost:${PORT}`;
const KEEP = process.argv.includes("--keep");

const dir = mkdtempSync(join(tmpdir(), "chc-errors-"));
let failures = 0;
const line = (ok, text) => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"} ${text}`);
};

/* ---- fixtures ------------------------------------------------------------------------- */

const AS_OF = "2026-03-31T23:59:59Z";
const meta = (cadence) => ({
  schemaVersion: 1,
  generated: "2026-08-01T12:00:00Z",
  cadence,
  source: "Coalition HMIS via Looker",
  disclaimer:
    "Unaffiliated concept work. Not produced, authorised or endorsed.",
});
const m = (value, cadence) => ({
  value,
  asOf: AS_OF,
  cadence,
  precision: "exact",
  kind: "count",
});

function fixtures() {
  mkdirSync(join(dir, "v1/data"), { recursive: true });
  const put = (name, body) =>
    writeFileSync(join(dir, "v1/data", name), JSON.stringify(body, null, 2));

  put("quarterly.json", {
    meta: meta("quarterly"),
    measures: {
      activelyHomeless: m(1263, "quarterly"),
      personsInFamilyHouseholds: m(197, "quarterly"),
      personsInYouthHouseholds: m(135, "quarterly"),
      familyHouseholds: m(59, "quarterly"),
    },
    breakdowns: {
      raceEthnicity: {
        asOf: AS_OF,
        cadence: "quarterly",
        precision: "exact",
        kind: "count",
        universe: 1263,
        minCell: 5,
        categories: [
          { label: "White", value: 664 },
          { label: "Black or African American", value: 401 },
          { label: "Multi-racial", value: 99 },
        ],
        residual: { label: "All other categories", value: 99 },
        suppressed: { count: 0, value: 0 },
      },
    },
  });
  put("live.json", {
    meta: meta("live"),
    measures: { queueTotal: m(1308, "live") },
  });
  put("annual.json", {
    meta: meta("annual"),
    series: {
      pitCount: {
        cadence: "annual",
        points: [
          { label: "2024", sheltered: 574, unsheltered: 233, value: 807 },
          { label: "2025", sheltered: 601, unsheltered: 244, value: 845 },
        ],
      },
    },
    flows: {
      all: { in: 934, out: 861, cadence: "annual", asOf: AS_OF },
      families: { in: 214, out: 233, cadence: "annual", asOf: AS_OF },
    },
  });
}

/* One refusal case per registered parameter, from the registry rather than typed out.
 *
 * They were typed out, and the list had drifted: `data-layout` and `data-titles` are shipped
 * parameters with no refusal case at all, so nothing asserted that a wrong value on either was
 * reported rather than quietly swallowed — which is the single promise this whole file exists to
 * keep. Generated from ALLOWED, a new parameter arrives with its case already written.
 *
 * `pit-trend` rather than `active-count` as the carrier, because it is the one widget that
 * responds to every parameter here, so a case can never pass by rendering something the
 * parameter does not touch. */
const PARAM_CASES = Object.keys(ALLOWED).map((attr) => [
  `bad-${attr.replace(/^data-/, "")}`,
  "CHC-02",
  `data-widgets="pit-trend" ${attr}="nonsense"`,
]);

/* Each case names the code it must produce. `none` means it must render clean. */
const CASES = [
  ["control-valid", "none", `data-widgets="active-count"`],
  ...PARAM_CASES,
  ["bad-years", "CHC-02", `data-widgets="pit-trend" data-years="five"`],
  ["no-widgets", "CHC-02", `data-theme="light"`],
  ["bad-selector", "CHC-02", `data-widgets="active-count" data-target="#3col"`],
  ["unknown-widget", "CHC-01", `data-widgets="actve-count"`],
  [
    "target-missing",
    "CHC-05",
    `data-widgets="active-count" data-target="#nowhere"`,
  ],
  [
    "bad-segment",
    "CHC-04",
    `data-widgets="inflow-outflow" data-segment="familes"`,
  ],
  [
    "two-problems",
    "CHC-02",
    `data-widgets="active-count" data-size="huge" data-years="x"`,
  ],
];

/* An optional attribute being wrong must not cost the partner their data. Every parameter case
   qualifies, by definition: all of them are optional. */
const MUST_STILL_RENDER = [
  ...PARAM_CASES.map(([name]) => name),
  "bad-years",
  "two-problems",
];

function pages(bundle) {
  const sections = CASES.map(
    ([id, , attrs]) =>
      `<section data-case="${id}"><h2>${id}</h2>` +
      `<script src="/${bundle}" defer ${attrs}></script></section>`,
  ).join("\n");

  writeFileSync(
    join(dir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>error paths</title>
<style>body{font:15px system-ui;background:#fff;color:#111;margin:0;padding:24px;max-width:1100px}
section{border-top:1px solid #ddd;padding:16px 0}
h2{font:600 12px ui-monospace,monospace;color:#666;margin:0 0 8px;text-transform:uppercase}</style>
${sections}`,
  );

  // The width guard measures the widget's own container, so it needs a genuinely narrow column
  // rather than a full-width section.
  writeFileSync(
    join(dir, "narrow.html"),
    `<!doctype html><meta charset="utf-8"><title>too narrow</title>
<style>body{font:15px system-ui;background:#fff;margin:0;padding:24px}
#pinch{width:200px;border:1px dashed #c00}</style>
<div id="pinch"></div>
<script src="/${bundle}" defer data-widgets="race-ethnicity" data-target="#pinch"></script>`,
  );

  /* The same pinch, with titles off. Its own page because the two conditions only broke when
     they met: the too-narrow branch carried a stray copy of the title-stripping block, which
     reads a variable declared inside the per-widget loop below it. With titles on — the default,
     and the only way anything was ever mounted — the condition short-circuited and the dead
     reference was never evaluated. With them off the pane threw `produced is not defined` and
     drew nothing, losing the refusal that is the entire job of that branch. */
  writeFileSync(
    join(dir, "narrow-untitled.html"),
    `<!doctype html><meta charset="utf-8"><title>too narrow, titles off</title>
<style>body{font:15px system-ui;background:#fff;margin:0;padding:24px}
#pinch{width:200px;border:1px dashed #c00}</style>
<div id="pinch"></div>
<script src="/${bundle}" defer data-widgets="race-ethnicity" data-titles="false" data-target="#pinch"></script>`,
  );
}

/* ---- run ------------------------------------------------------------------------------ */

console.log(`building against ${ORIGIN}`);
execFileSync("node", [join(ROOT, "embed/build.mjs")], {
  cwd: ROOT,
  env: { ...process.env, DATA_ORIGIN: ORIGIN },
  stdio: "pipe",
});
// manifest.file is the S3 key ("v1/chc.<hash>.js"); the build leaves the file itself at
// dist/chc.<hash>.js because the v1/ prefix is added at upload time. Serve it under the key so
// the page loads it from the same path a partner's tag will.
const bundle = JSON.parse(
  readFileSync(join(ROOT, "dist/manifest.json"), "utf-8"),
).file;
mkdirSync(join(dir, "v1"), { recursive: true });
writeFileSync(
  join(dir, bundle),
  readFileSync(join(ROOT, "dist", bundle.split("/").pop())),
);

fixtures();
pages(bundle);

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
};
const server = createServer((req, res) => {
  const path = join(dir, decodeURIComponent(req.url.split("?")[0]));
  try {
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] || "application/octet-stream",
      "access-control-allow-origin": "*",
    });
    res.end(readFileSync(path));
  } catch {
    res.writeHead(404).end("no");
  }
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
const noise = [];
page.on("console", (msg) => msg.type() === "error" && noise.push(msg.text()));
page.on("pageerror", (err) => noise.push(`UNCAUGHT: ${err.message}`));

await page.goto(`${ORIGIN}/index.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);

const seen = await page.evaluate(() =>
  [...document.querySelectorAll("section[data-case]")].map((s) => {
    const codes = [];
    const details = [];
    for (const host of s.querySelectorAll("div")) {
      if (!host.shadowRoot) continue;
      for (const c of host.shadowRoot.querySelectorAll(".code"))
        codes.push(c.textContent);
      for (const d of host.shadowRoot.querySelectorAll(".detail"))
        details.push(d.textContent);
    }
    return {
      id: s.dataset.case,
      codes,
      details,
      hasData: [...s.querySelectorAll("div")].some(
        (h) =>
          h.shadowRoot && h.shadowRoot.querySelector(".figure, .bars, .cols"),
      ),
    };
  }),
);
const find = (id) => seen.find((s) => s.id === id);

console.log("\n--- which card appeared ---");
for (const [id, want] of CASES) {
  const got = find(id);
  if (!got) {
    line(false, `${id}: section missing`);
    continue;
  }
  if (want === "none")
    line(got.codes.length === 0 && got.hasData, `${id}: clean, no error card`);
  else
    line(
      got.codes.includes(want),
      `${id}: expected ${want}, got [${got.codes.join(",")}]`,
    );
}

console.log("\n--- the message carries the values that would have worked ---");
for (const [id, want] of CASES) {
  if (want === "none" || want === "CHC-05") continue; // CHC-05's fix is an element, not a value
  const got = find(id);
  const lists = (got?.details || []).some((d) => /Allowed:|Available:/.test(d));
  line(lists, `${id}: ${JSON.stringify((got?.details[0] || "").slice(0, 90))}`);
}

console.log("\n--- a wrong optional attribute does not blank the page ---");
for (const id of MUST_STILL_RENDER)
  line(find(id)?.hasData, `${id}: widget rendered too`);

console.log("\n--- all problems at once, not one per round trip ---");
line(
  find("two-problems")?.codes.length === 2,
  `two-problems: ${find("two-problems")?.codes.length} cards (want 2)`,
);
line(
  find("target-missing")?.hasData,
  "target-missing: widget rendered at the tag rather than vanishing",
);

if (KEEP)
  await page.screenshot({ path: join(dir, "errors.png"), fullPage: true });

console.log("\n--- too narrow, and its recovery ---");
await page.goto(`${ORIGIN}/narrow.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const shadowUnder = (sel) =>
  `[...document.querySelectorAll("${sel} div")].find((d) => d.shadowRoot)`;
const narrow = await page.evaluate((expr) => {
  const sr = eval(expr)?.shadowRoot;
  return {
    code: sr?.querySelector(".code")?.textContent || null,
    detail: sr?.querySelector(".detail")?.textContent || "",
  };
}, shadowUnder("#pinch"));
line(
  narrow.code === "CHC-06",
  `200px column: got ${narrow.code} — ${JSON.stringify(narrow.detail.slice(0, 70))}`,
);

// A one-way latch would strand the widget behind the notice forever once the layout recovered.
await page.evaluate(
  () => (document.querySelector("#pinch").style.width = "600px"),
);
await page.waitForTimeout(500);
const back = await page.evaluate((expr) => {
  const sr = eval(expr).shadowRoot;
  return {
    code: sr.querySelector(".code")?.textContent || null,
    bars: !!sr.querySelector(".bars"),
  };
}, shadowUnder("#pinch"));
line(
  back.code === null && back.bars,
  `widened to 600px: recovers (code=${back.code}, bars=${back.bars})`,
);

await page.goto(`${ORIGIN}/narrow-untitled.html`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const untitled = await page.evaluate((expr) => {
  const sr = eval(expr)?.shadowRoot;
  return {
    code: sr?.querySelector(".code")?.textContent || null,
    mounted: !!sr,
  };
}, shadowUnder("#pinch"));
line(
  untitled.code === "CHC-06",
  `200px column with data-titles="false": got ${untitled.code}` +
    (untitled.mounted ? "" : " — nothing mounted at all"),
);

console.log("\n--- console ---");
line(
  noise.length === 0,
  `${noise.length} console errors${noise.length ? ": " + noise.join(" | ") : ""}`,
);

await browser.close();
server.close();
if (KEEP) console.log(`\nkept: ${dir}`);
else rmSync(dir, { recursive: true, force: true });

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
