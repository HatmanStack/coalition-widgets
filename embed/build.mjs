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
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
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

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

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
};
writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

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
