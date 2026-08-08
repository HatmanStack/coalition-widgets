#!/usr/bin/env node
/* Build the IIFE bundle: one file, no runtime dependencies, hash-named and immutable.
 *
 *   node embed/build.mjs --origin https://d111111abcdef8.cloudfront.net --build 3
 *
 * The data origin is baked in rather than read from an attribute. That removes a parameter
 * nobody should be setting and makes the `connect-src` a partner has to allow a fixed string,
 * which matters because we have to tell them exactly what to add.
 *
 * The output is hash-named, so a partner pins one build with an SRI digest and it can never
 * change under them. `meta.minBundle` in the data is what retires an old one.
 */

import { build } from "esbuild";
import { PARAMS } from "./src/params.js";
import { CATALOGUE, NAMES } from "./src/widgets/index.js";
import { llmText } from "./llm.mjs";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "dist");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
};

const ORIGIN = arg("origin", process.env.DATA_ORIGIN || "");
const MAX_GZIP = 30 * 1024;

if (!ORIGIN) {
  console.error(
    "\n  --origin is required. It is baked into the bundle and becomes the only host the\n" +
      "  embed talks to, and the only one a partner has to allow in connect-src.\n" +
      "  After a deploy it is the DistributionDomainName output.\n",
  );
  process.exit(1);
}
// https, or localhost for a smoke test. http anywhere else would mean the embed fetching over
// plaintext from someone else's page, which a partner's CSP should refuse anyway.
const LOCAL = /^http:\/\/localhost:\d+$/;
if (!/^https:\/\/[^/]+$/.test(ORIGIN) && !LOCAL.test(ORIGIN)) {
  console.error(
    `\n  --origin must be https with no trailing path, or http://localhost:PORT for a local\n` +
      `  smoke test. Got ${ORIGIN}\n`,
  );
  process.exit(1);
}

/* Clear the previous bundle and manifest, and nothing else.
 *
 * This used to wipe the whole output directory, which also deleted `v1/data/*.json` — the
 * payloads `scripts/local-publish.py` writes there. So building after publishing silently
 * destroyed the data and every widget came up on CHC-03 with the page looking, at a glance,
 * like a network problem.
 *
 * Old bundles do have to go: they are hash-named, so leaving them would accumulate a directory
 * of dead builds and make it ambiguous which one an upload should carry. But a build has no
 * business removing files it did not create. */
mkdirSync(OUT, { recursive: true });
for (const stale of readdirSync(OUT)) {
  if (/^chc\.[0-9a-f]+\.js$/.test(stale) || stale === "manifest.json") {
    rmSync(join(OUT, stale), { force: true });
  }
}

/* The stylesheet is one template literal, and a backtick inside it ends the literal early —
 * the rest of the CSS then parses as JavaScript. This has happened three times. Twice it was a
 * syntax error and obvious; once it built cleanly and shipped a bundle whose layout rules had
 * silently become code, which threw `list is not defined` at runtime and looked like a logic
 * bug. esbuild cannot warn about it, because the result is valid JavaScript. */
const sheet = readFileSync(join(HERE, "src", "sheet.js"), "utf-8");
const cssBody = sheet.slice(
  sheet.indexOf("const CSS = `") + 13,
  sheet.lastIndexOf("`;"),
);
if (cssBody.includes("`")) {
  const line = cssBody.slice(0, cssBody.indexOf("`")).split("\n").length;
  console.error(
    `\n  sheet.js: a backtick inside the CSS template literal, around line ${line} of it.\n` +
      `  It ends the literal early and the remaining CSS becomes JavaScript.\n`,
  );
  process.exit(1);
}

const result = await build({
  entryPoints: [join(HERE, "src", "boot.js")],
  bundle: true,
  format: "iife",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
  write: false,
  define: {
    __DATA_ORIGIN__: JSON.stringify(ORIGIN),
  },
});

const code = result.outputFiles[0].contents;
const hash = createHash("sha256").update(code).digest("hex").slice(0, 8);
const digest = createHash("sha384").update(code).digest("base64");
const name = `chc.${hash}.js`;

writeFileSync(join(OUT, name), code);

const { gzipSync } = await import("node:zlib");
const gzipped = gzipSync(code).length;

const manifest = {
  file: `v1/${name}`,
  integrity: `sha384-${digest}`,
  origin: ORIGIN,
  bytes: code.length,
  gzip: gzipped,
  tag:
    `<script src="${ORIGIN}/v1/${name}"\n` +
    `        integrity="sha384-${digest}"\n` +
    `        crossorigin="anonymous" defer\n` +
    `        data-widgets="hmis-snapshot"></script>`,
  /* The registry, carried to anything that needs to enumerate it. The harness fetches this
     manifest already, and it used to hand-maintain its own copy of both lists: the widget
     checkboxes had gone stale at eleven while the catalogue reached thirteen, and two of the six
     parameters had no control at all because nobody remembered to add one. Emitted here, from
     the same constants the bundle enforces, so the next parameter arrives with a control. */
  params: PARAMS,
  widgets: NAMES,
  // How often each one moves. The site prints it in the widget table, and it is a property of
  // the catalogue entry rather than anything the site could work out for itself.
  cadences: Object.fromEntries(
    NAMES.map((n) => [n, CATALOGUE[n].cadence || "quarterly"]),
  ),
  /* The second file a widget reads, where there is one. Carried because `cadences` alone is not
     the whole clock: `queue` is live *and* weekly, and a site holding only the first of those
     described the whole card as continuous. Emitted from the same `also` the bundle uses to
     decide which files to fetch, so the two cannot disagree about it. */
  also: Object.fromEntries(
    NAMES.filter((n) => CATALOGUE[n].also?.length).map((n) => [
      n,
      CATALOGUE[n].also,
    ]),
  ),
};
writeFileSync(
  join(OUT, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

/* llm.txt, from the same catalogue and the same allowed values the bundle enforces. Generated
   rather than maintained by hand because the src and integrity in it change on every build — a
   committed tag is stale immediately, and a document that states a stale URL confidently is
   worse than none, since the reader acts on it.

   The page a person reads used to be generated here too. It is a React site in web/ now,
   deployed separately, and it imports the prose the two of them share from content.mjs. */
writeFileSync(
  join(OUT, "llm.txt"),
  llmText({
    origin: ORIGIN,
    manifest,
    catalogue: CATALOGUE,
    names: NAMES,
    params: PARAMS,
  }),
);

console.log(`  ${name}`);
console.log(`  ${code.length} bytes, ${gzipped} gzipped`);
console.log(`  integrity sha384-${digest.slice(0, 24)}...`);
console.log(`  origin ${ORIGIN}`);

if (gzipped > MAX_GZIP) {
  console.error(
    `\n  Over budget: ${gzipped} gzipped against a ceiling of ${MAX_GZIP}. This runs on other\n` +
      `  people's pages, so the ceiling is a hard failure rather than a warning.\n`,
  );
  process.exit(1);
}
console.log(`  under the ${MAX_GZIP} byte budget\n`);
