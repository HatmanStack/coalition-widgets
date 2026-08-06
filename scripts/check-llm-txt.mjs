#!/usr/bin/env node
/* The two facts in llm.txt that must not go quietly out of date.
 *
 * The file is written by hand, deliberately. A generator can only emit what it can compute, and
 * what makes that document good — the triage before answering, the symptom list, the routing
 * rule, "when you cannot tell, saying so is the correct answer" — is not computable. It used to
 * be generated and it was thinner for it.
 *
 * So this checks the two things in it that are exact strings, and nothing else:
 *
 *     every widget name in the catalogue appears somewhere in the file
 *     every absolute URL in the file is the origin the site is configured to use
 *
 * Neither needs to parse the prose or know how it is laid out, which is the point. A check that
 * understood the document's structure would break every time the document was rewritten, and
 * rewriting it freely is the thing this is meant to keep safe.
 *
 * Why only these two, when most of the file is unverifiable. This is the support path: somebody
 * photographs a broken widget, a model reads this, and the answer goes onto a live page. And the
 * file does not merely omit what it does not know — it says "any name not in this list is not
 * real". A widget that ships without being written up here therefore becomes a confident denial
 * to somebody with no way to check it, and a stale host becomes content-security-policy advice
 * that blocks the bundle. Those two are worth a build failure. The rest is judgement, and stays
 * unpoliced.
 *
 *   node scripts/check-llm-txt.mjs
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAMES } from "../embed/src/widgets/index.js";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const DOC = join(ROOT, "web/public/llm.txt");
const ENV = join(ROOT, "web/.env");

const text = readFileSync(DOC, "utf-8");

// Comment lines are skipped: web/.env documents the local override in a comment, and reading
// that as the setting would make the check assert against localhost.
const declared = readFileSync(ENV, "utf-8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("#"))
  .map((line) => line.match(/^\s*VITE_WIDGET_ORIGIN\s*=\s*(\S+)/))
  .find(Boolean)?.[1];

const results = [];
const check = (ok, label, detail = "") => results.push({ ok, label, detail });

const missing = NAMES.filter((name) => !text.includes(name));
check(
  missing.length === 0,
  `all ${NAMES.length} widget names appear in llm.txt`,
  missing.length ? `absent: ${missing.join(", ")}` : "",
);

check(!!declared, "web/.env declares VITE_WIDGET_ORIGIN");

// Origin only. A path that has moved is a broken link; a host that has moved is a partner being
// told to allow the wrong domain in their content security policy, which fails silently.
const origins = [
  ...new Set(
    (text.match(/https?:\/\/[^\s"'<>)]+/g) || []).map((u) => {
      const m = u.match(/^https?:\/\/[^/]+/);
      return m[0];
    }),
  ),
];
const wrong = origins.filter((o) => o !== declared);
check(
  wrong.length === 0,
  `every URL in llm.txt points at ${declared}`,
  wrong.length
    ? `found ${wrong.join(", ")} — if one of these is deliberate, this check needs to know`
    : "",
);

const width = Math.max(...results.map((r) => r.label.length));
let failures = 0;
for (const { ok, label, detail } of results) {
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(width)}  ${ok ? "" : detail}`.trimEnd(),
  );
}
console.log(
  failures === 0
    ? `\n  llm.txt agrees with the catalogue and the deployed origin`
    : `\n  ${failures} of ${results.length} checks failed`,
);
process.exit(failures ? 1 : 0);
