#!/usr/bin/env node
/* Every way the mock can lie, run through the real publisher.
 *
 * `valid` must publish. Every other scenario must be refused. A hostile scenario that starts
 * publishing is a check that has stopped working, which is the failure this whole project
 * exists to prevent — and it is invisible from the outside, because a payload that passes looks
 * exactly like a payload that should have passed.
 *
 * The scenario list comes from the mock rather than from a list kept here. Seven separate
 * hardcoded copies of a registry drifted out of step during this project's first week, and a
 * test that silently stops covering a case is the worst place for it to happen next.
 *
 *   node scripts/check-scenarios.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { SCENARIOS } from "../mock-looker/scenarios.mjs";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const PORT = 8241;

const names = Object.keys(SCENARIOS);
const width = Math.max(...names.map((n) => n.length));
let failures = 0;

for (const name of names) {
  const stub = spawn(
    "node",
    [`${ROOT}/scripts/looker-stub.mjs`, `--scenario=${name}`, `--port=${PORT}`],
    { cwd: ROOT, stdio: "ignore" },
  );
  await new Promise((r) => setTimeout(r, 600));

  let published;
  let output = "";
  try {
    const run = spawnSync("python3", [`${ROOT}/scripts/local-publish.py`], {
      cwd: ROOT,
      encoding: "utf-8",
      env: { ...process.env, LOOKER_STUB: `http://localhost:${PORT}` },
    });
    published = run.status === 0;
    output = `${run.stdout || ""}${run.stderr || ""}`;
  } finally {
    stub.kill();
  }

  const shouldPublish = name === "valid";
  const ok = published === shouldPublish;
  if (!ok) failures++;

  const why =
    (output.match(/REFUSED\s+(.*)/) || [])[1]?.slice(0, 74) ||
    (published ? "published" : "refused, no reason given");
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(width)}  ${why}`);
}

console.log(
  failures === 0
    ? `\n  ${names.length} scenarios, all as expected`
    : `\n  ${failures} of ${names.length} did not behave as expected`,
);
process.exit(failures === 0 ? 0 : 1);
