#!/usr/bin/env node
/* The acceptance test, run against every key posture the mock can take.
 *
 * `scripts/acceptance.py` is what stands between a real Looker key and the stack. A key kept
 * broader than the spec must FAIL, and a refusal that is not a 403 must not read as a PASS. Each
 * posture's expected verdict lives beside it in the mock's `ACCESS`, not in a list here.
 *
 * It also holds the script to what it promises about its output: the key, and any figure the
 * mock served, must never appear in what it prints.
 *
 *   node scripts/check-acceptance.mjs
 */

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ACCESS } from "../mock-looker/scenarios.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(
  /[\\/]$/,
  "",
);
const PORT = 8242;
const EXIT = { PASS: 0, FAIL: 1, INCONCLUSIVE: 2 };
const CLIENT_ID = "rehearsal-client-id";
const SECRET = "rehearsal-secret-must-not-print";
// Served by the mock on both run_look and the open key's inline query. A value, not a count.
const FIGURE = "1263";

const width = Math.max(...Object.keys(ACCESS).map((n) => n.length));
let failures = 0;

for (const [name, posture] of Object.entries(ACCESS)) {
  const stub = spawn(
    "node",
    [`${ROOT}/scripts/looker-stub.mjs`, `--access=${name}`, `--port=${PORT}`],
    { cwd: ROOT, stdio: "ignore" },
  );
  await new Promise((r) => setTimeout(r, 600));

  let run;
  try {
    run = spawnSync(
      "python3",
      [
        `${ROOT}/scripts/acceptance.py`,
        `--host=http://localhost:${PORT}`,
        "--look=1001",
      ],
      {
        cwd: ROOT,
        encoding: "utf-8",
        env: {
          ...process.env,
          LOOKER_CLIENT_ID: CLIENT_ID,
          LOOKER_CLIENT_SECRET: SECRET,
        },
      },
    );
  } finally {
    stub.kill();
  }

  const output = `${run.stdout || ""}${run.stderr || ""}`;
  const problems = [];
  if (run.status !== EXIT[posture.expect])
    problems.push(
      `exit ${run.status}, expected ${EXIT[posture.expect]} (${posture.expect})`,
    );
  if (output.includes(SECRET) || output.includes(CLIENT_ID))
    problems.push("printed the key");
  if (output.includes(FIGURE)) problems.push("printed a figure");

  if (problems.length) failures++;
  console.log(
    `  ${problems.length ? "FAIL" : "ok  "}  ${name.padEnd(width)}  ${problems.join("; ") || posture.expect}`,
  );
}

console.log(
  failures === 0
    ? `\n  ${Object.keys(ACCESS).length} postures, all as expected`
    : `\n  ${failures} posture(s) did not behave as expected`,
);
process.exit(failures === 0 ? 0 : 1);
