#!/usr/bin/env node
/* The acceptance test, run against every key posture the mock can take.
 *
 * The acceptance test is what stands between a real Looker key and the stack. A key kept broader
 * than the spec must FAIL, and a refusal that is not a 403 must not read as a PASS. Each
 * posture's expected verdict lives beside it in the mock's `ACCESS`, not in a list here.
 *
 * It also holds each script to what it promises about its output: the key, and any figure the
 * mock served, must never appear in what it prints.
 *
 * There are three copies of one judgement — Python for CloudShell, bash for a Mac, PowerShell
 * for Windows — because a stock laptop has no Python. Copies of a rule in this project have
 * drifted apart every time they were not tested together, so every runner available here is run
 * against every posture and must reach the same verdict.
 *
 *   node scripts/check-acceptance.mjs                 the runners this platform has
 *   node scripts/check-acceptance.mjs --runner ps1    one of them
 */

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ACCESS } from "../mock-looker/scenarios.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(
  /[\\/]$/,
  "",
);
const PORT = 8242;
/* Same flags in all three, so the command a partner is given differs only in what launches it. */
const RUNNERS = {
  py: { cmd: "python3", args: ["scripts/acceptance.py"] },
  sh: { cmd: "bash", args: ["scripts/acceptance_mac.sh"] },
  ps1: {
    cmd: "powershell",
    args: [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "scripts/acceptance_windows.ps1",
    ],
  },
};
const asked = process.argv.find((a) => a.startsWith("--runner"));
const chosen = asked
  ? (asked.includes("=")
      ? asked.split("=")[1]
      : process.argv[process.argv.indexOf(asked) + 1]
    ).split(",")
  : process.platform === "win32"
    ? ["ps1"]
    : ["py", "sh"];
for (const r of chosen)
  if (!RUNNERS[r]) {
    console.error(
      `unknown runner ${r}. Known: ${Object.keys(RUNNERS).join(", ")}`,
    );
    process.exit(1);
  }
const EXIT = { PASS: 0, FAIL: 1, INCONCLUSIVE: 2 };
const CLIENT_ID = "rehearsal-client-id";
const SECRET = "rehearsal-secret-must-not-print";
// Served by the mock on both run_look and the open key's inline query. A value, not a count.
const FIGURE = "1263";

const width = Math.max(...Object.keys(ACCESS).map((n) => n.length));
let failures = 0;

for (const runner of chosen)
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
        RUNNERS[runner].cmd,
        [
          ...RUNNERS[runner].args.map((a) =>
            a.startsWith("scripts/") ? `${ROOT}/${a}` : a,
          ),
          "--host",
          `http://localhost:${PORT}`,
          "--look",
          "1001",
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
      `  ${problems.length ? "FAIL" : "ok  "}  ${runner.padEnd(3)}  ${name.padEnd(width)}  ${problems.join("; ") || posture.expect}`,
    );
  }

const total = chosen.length * Object.keys(ACCESS).length;
console.log(
  failures === 0
    ? `\n  ${total} runs (${chosen.join(", ")} x ${Object.keys(ACCESS).length} postures), all as expected`
    : `\n  ${failures} of ${total} did not behave as expected`,
);
process.exit(failures === 0 ? 0 : 1);
