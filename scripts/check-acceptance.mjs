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
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  // The same file under PowerShell 7, which many Windows machines also have. It differs from
  // 5.1 in ways that reach this script: ConvertFrom-Json enumerates an array there, so a
  // one-row response read as "not rows" until the check stopped asking the parsed object.
  pwsh: {
    cmd: "pwsh",
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

/* Three things about the PowerShell copy that cannot be seen by reading it on a Mac or a Linux
   box, and that have each cost a CI round trip:

   - Windows PowerShell 5.1 reads a .ps1 as ANSI unless it has a byte order mark, so a UTF-8 em
     dash arrives as three CP1252 characters, one of which PowerShell treats as a quote.
   - "$name:" is a drive-qualified variable reference, like $env:PATH. "logout returned $code:"
     is a parse error, and the file will not run at all.

   Checked here rather than on the runner, because a parse error makes every posture exit 1 -
   which looks like a correct answer for the two postures that expect 1. */
const ps1 = readFileSync(`${ROOT}/scripts/acceptance_windows.ps1`);
const ps1Text = ps1.toString("utf8").replace(/^\uFEFF/, ""); // the mark itself is not content
const ps1Problems = [];
if (!ps1.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])))
  ps1Problems.push(
    "no byte order mark: Windows PowerShell 5.1 will read it as ANSI",
  );
for (const [i, l] of ps1Text.split("\n").entries()) {
  const nonAscii = [...l].find((c) => c.charCodeAt(0) > 127);
  if (nonAscii)
    ps1Problems.push(
      `line ${i + 1}: non-ASCII ${JSON.stringify(nonAscii)}, which needs the BOM to survive`,
    );
  const drive = l.match(
    /\$(?!env:|script:|global:|using:|local:|private:)[A-Za-z_][A-Za-z0-9_]*:/,
  );
  if (drive && !l.trimStart().startsWith("#"))
    ps1Problems.push(
      `line ${i + 1}: ${drive[0]} reads as a drive-qualified variable; use \${name}:`,
    );
}
if (ps1Problems.length) {
  console.error("  acceptance_windows.ps1 will not parse on Windows:");
  for (const p of ps1Problems) console.error(`    ${p}`);
  process.exit(1);
}

/* Nothing else may be on the port. A stub left over from an interrupted run keeps serving the
   posture it was started with, and every run after it then tests a key nobody asked about: the
   whole suite reported 404s from a `masked` stub while claiming to test `scoped`. */
await new Promise((resolve, reject) => {
  const probe = createServer()
    .once("error", (e) =>
      reject(
        new Error(
          e.code === "EADDRINUSE"
            ? `port ${PORT} is already in use, probably a looker-stub left from an interrupted run. ` +
                `Stop it first: pkill -f "looker-stub.mjs --access"`
            : e.message,
        ),
      ),
    )
    .once("listening", () => probe.close(resolve));
  probe.listen(PORT);
});

const width = Math.max(...Object.keys(ACCESS).map((n) => n.length));
let failures = 0;
// Not just the verdict: the whole printed page, compared between the runners this platform can
// run together. Whoever runs the test is told to send back any "note" line, so two copies
// wording the same finding differently is a question nobody should have to answer twice - which
// is what happened when bash said "outside folder unknown" and Python said "across 1 folder(s)".
const printed = {};

for (const runner of chosen)
  for (const [name, posture] of Object.entries(ACCESS)) {
    const stub = spawn(
      "node",
      [`${ROOT}/scripts/looker-stub.mjs`, `--access=${name}`, `--port=${PORT}`],
      { cwd: ROOT, stdio: "ignore" },
    );
    await new Promise((r) => setTimeout(r, 600));

    /* A TEMP of its own, so "the bodies are deleted on the way out" is checked rather than
       claimed. All three read it: mktemp -d and Python's tempfile take TMPDIR, PowerShell takes
       TEMP. Every run holds a login token there, and a key that should have been refused holds
       rows too. */
    const scratch = mkdtempSync(join(tmpdir(), "acceptance-"));
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
            TMPDIR: scratch,
            TEMP: scratch,
            TMP: scratch,
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
    printed[name] ??= {};
    printed[name][runner] = output;
    const left = readdirSync(scratch);
    if (left.length)
      problems.push(`left ${left.length} file(s) behind in TEMP`);
    rmSync(scratch, { recursive: true, force: true });

    if (problems.length) failures++;
    console.log(
      `  ${problems.length ? "FAIL" : "ok  "}  ${runner.padEnd(3)}  ${name.padEnd(width)}  ${problems.join("; ") || posture.expect}`,
    );
    // What it actually printed, when it did not do what it should. A guard that reports a
    // failure without the evidence for it sends whoever reads it back to reproduce by hand.
    if (problems.length)
      console.log(
        output
          .trimEnd()
          .split("\n")
          .map((l) => `          | ${l}`)
          .join("\n") || "          | (no output)",
      );
  }

for (const [name, byRunner] of Object.entries(printed)) {
  const [first, ...rest] = Object.entries(byRunner);
  for (const [runner, output] of rest)
    if (output !== first[1]) {
      failures++;
      console.log(
        `  FAIL  ${runner} and ${first[0]} printed different pages for ${name}`,
      );
      const a = first[1].split("\n");
      const b = output.split("\n");
      for (let i = 0; i < Math.max(a.length, b.length); i++)
        if (a[i] !== b[i]) {
          console.log(`          ${first[0]} | ${a[i] ?? "(nothing)"}`);
          console.log(
            `          ${runner.padEnd(first[0].length)} | ${b[i] ?? "(nothing)"}`,
          );
        }
    }
}

const total = chosen.length * Object.keys(ACCESS).length;
console.log(
  failures === 0
    ? `\n  ${total} runs (${chosen.join(", ")} x ${Object.keys(ACCESS).length} postures), all as expected`
    : `\n  ${failures} of ${total} did not behave as expected`,
);
process.exit(failures === 0 ? 0 : 1);
