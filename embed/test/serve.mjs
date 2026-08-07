/* One command to get a real widget on a real page, with no AWS and no Looker.
 *
 *   npm run dev                          valid data
 *   npm run dev -- --scenario small-cell  the publisher refuses; nothing is written
 *   npm run dev -- --port 3000
 *
 * It does, in order, the four things that have to happen in that order:
 *
 *   1. start the Looker stub                     (mock-looker/scenarios.mjs)
 *   2. run the real publisher against it         (writes dist/v1/data/*.json)
 *   3. build the bundle for this origin          (the origin is baked in at build time)
 *   4. serve dist plus the harness page
 *
 * Step 3 cannot precede step 4's address being known, which is why the port is decided first
 * and why changing it means a rebuild. That is the same constraint the real deploy has with
 * the CloudFront hostname, so it is worth feeling here.
 */

import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const DIST = join(ROOT, "dist");
const HARNESS = join(ROOT, "embed/test/harness.html");

const flag = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const PORT = Number(flag("port", 8080));
const SCENARIO = flag("scenario", "valid");
const STUB_PORT = 8200;
const ORIGIN = `http://localhost:${PORT}`;

const step = (n, m) => console.log(`\n  ${n}. ${m}`);
const die = (m) => {
  console.error(`\n  ${m}\n`);
  process.exit(1);
};

// ---- 1. the Looker stub -------------------------------------------------------------------

step(1, `Looker stub on :${STUB_PORT}  (scenario: ${SCENARIO})`);
const stub = spawn(
  "node",
  [
    join(ROOT, "scripts/looker-stub.mjs"),
    `--scenario=${SCENARIO}`,
    `--port=${STUB_PORT}`,
  ],
  { cwd: ROOT, stdio: ["ignore", "pipe", "inherit"] },
);
stub.stdout.on("data", (b) =>
  process.stdout.write(`     ${b}`.replace(/\n(?!$)/g, "\n     ")),
);

// Whatever happens after this, the child must not outlive it. A stray stub holding :8200 makes
// the next run fail with an error that says nothing about the real cause.
const cleanup = () => {
  if (!stub.killed) stub.kill();
};
for (const sig of ["exit", "SIGINT", "SIGTERM"]) process.on(sig, cleanup);
process.on("uncaughtException", (e) => {
  cleanup();
  die(e.message);
});

await new Promise((r) => setTimeout(r, 700));

// ---- 2. the real publisher ----------------------------------------------------------------

step(2, "publishing through publisher/app.py");
const published = spawnSync(
  "python3",
  [join(ROOT, "scripts/local-publish.py")],
  {
    cwd: ROOT,
    encoding: "utf-8",
  },
);
const refusals = (published.stdout || "")
  .split("\n")
  .filter((l) => l.includes("REFUSED"));
for (const line of refusals) console.log(`    ${line.trim()}`);

if (published.status !== 0) {
  // Not fatal. A refusal is the correct outcome for a hostile scenario and the page should
  // still come up, showing whatever is on disk — which is how a partner sees a failed refresh.
  console.log(
    `     the publisher refused. The page will serve whatever was already written.`,
  );
} else {
  console.log(`     wrote dist/v1/data/*.json`);
}

if (!existsSync(join(DIST, "v1/data/quarterly.json"))) {
  die(
    `Nothing has ever been published, so there is no data to serve.\n` +
      `      Run once with the valid scenario first:  npm run dev`,
  );
}

// ---- 3. the bundle ------------------------------------------------------------------------

step(3, `building the bundle for ${ORIGIN}`);
const built = spawnSync("node", [join(ROOT, "embed/build.mjs")], {
  cwd: ROOT,
  encoding: "utf-8",
  env: { ...process.env, DATA_ORIGIN: ORIGIN },
});
if (built.status !== 0) die(`build failed:\n\n${built.stdout}${built.stderr}`);
const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf-8"));
console.log(`     ${manifest.file}  ${manifest.gzip} bytes gzipped`);

// ---- 4. serve -----------------------------------------------------------------------------

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  // Without this llm.txt goes out as octet-stream and the browser downloads it instead of
  // showing it, which is a strange thing for a link in a navigation bar to do.
  ".txt": "text/plain; charset=utf-8",
};

/* This is the widget origin, and only that: the bundle, the manifest, the data and llm.txt —
   the same four things the CloudFront distribution serves in production.

   It used to serve the pages too, with a navigation bar injected on the way out so it could
   never ship. The pages are a React site in web/ now, deployed separately by Amplify, so the
   split here is the same split that exists in production rather than a local convenience. Run
   `npm run dev` here for the widgets and `npm run dev` in web/ for the site. */

createServer((req, res) => {
  const url = req.url.split("?")[0];

  /* The one page left here, and it is ours rather than a partner's. The builder in web/ is the
     tag builder a partner uses; this covers what that deliberately leaves out — a transparent
     and a strongly tinted background, and the 240/239 boundary where the widget must refuse.
     It is not deployed anywhere and is not meant to be. */
  if (url === "/harness" || url === "/harness.html") {
    res
      .writeHead(200, {
        "content-type": TYPES[".html"],
        "cache-control": "no-store",
      })
      .end(readFileSync(HARNESS));
    return;
  }

  // Data keeps the v1/ prefix it has in S3; the bundle's key carries one too but on disk it
  // sits directly in dist/. Anything else is looked up by basename.
  const path = url.startsWith("/v1/data/")
    ? join(DIST, url.slice(1))
    : join(DIST, url.split("/").pop());

  let body;
  try {
    body = readFileSync(path);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end(`no ${url}`);
    return;
  }

  const type = TYPES[extname(path)] || "application/octet-stream";

  res
    .writeHead(200, {
      "content-type": type,
      "access-control-allow-origin": "*",
      // No caching: the whole point is to rebuild and reload.
      "cache-control": "no-store",
    })
    .end(body);
}).listen(PORT, () => {
  console.log(`\n  ready   ${ORIGIN}   the widget origin`);
  console.log(`            ${manifest.file}`);
  console.log(
    `            v1/manifest.json   the catalogue and the allowed values`,
  );
  console.log(`            v1/data/*.json     the published figures`);
  console.log(
    `            llm.txt            the reference an assistant reads\n`,
  );
  console.log(
    `            /harness           our own, not deployed anywhere\n`,
  );
  console.log(`  The site partners see is the React app in web/:\n`);
  console.log(`      cd web && npm run dev\n`);
  console.log(
    `  It reads this origin by default, so leave this running while you work on it.`,
  );
  console.log(`  Ctrl-C to stop.\n`);
});
