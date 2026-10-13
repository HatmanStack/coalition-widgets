#!/usr/bin/env node
/* The Windows acceptance test as text to paste, for a machine whose Group Policy forbids running
 * script files.
 *
 * A Group Policy "Turn on Script Execution" setting overrides the execution policy in every
 * scope, including `powershell -ExecutionPolicy Bypass`. No parameter beats it. What it governs
 * is script *files*, so the way through is to not have one: paste the thing into the console.
 *
 * Generated, never written by hand. A fifth hand-maintained copy of one judgement is how this
 * project has lost a day more than once, and this one would be the copy nobody could test by
 * reading it. Everything here is a transform of scripts/acceptance_windows.ps1, which is the
 * copy that CI runs against every key posture:
 *
 *   - the --host/--look parsing becomes two prompts, since pasted text takes no arguments
 *   - `exit N` becomes a verdict variable and a return, because `exit` in a console closes the
 *     window and takes the result off the screen with it
 *   - the whole thing becomes a function and a call, so a half-pasted block does nothing rather
 *     than something
 *
 *   node scripts/make-nofile-snippet.mjs           write it
 *   node scripts/make-nofile-snippet.mjs --check   fail if what is committed is out of date
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(
  /[\\/]$/,
  "",
);
const SOURCE = `${ROOT}/scripts/acceptance_windows.ps1`;
const TARGET = `${ROOT}/scripts/acceptance_windows_nofile.txt`;

const replace = (text, from, to) => {
  const count = text.split(from).length - 1;
  if (count !== 1)
    throw new Error(
      `make-nofile-snippet: expected one match for ${JSON.stringify(from.slice(0, 60))}, found ${count}. ` +
        `acceptance_windows.ps1 changed shape; update this generator rather than hand-editing the snippet.`,
    );
  return text.split(from).join(to);
};

/* Line endings normalised on the way in. A Windows checkout converts LF to CRLF, so matching on
   LF found nothing there and the generator failed on the runner rather than on the machine it
   was written on. .gitattributes pins these files to LF as well; this is the belt. */
const read = (path) =>
  readFileSync(path, "utf8")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n");

let ps1 = read(SOURCE);

// Arguments do not survive a paste. Ask instead, with the same environment variables the scripts
// already honour so the checker can drive it without a keyboard.
ps1 = replace(
  ps1,
  `$LookerHost = ""; $LookId = ""; $ClientField = ""
for ($i = 0; $i -lt $args.Count; $i++) {
  switch ($args[$i]) {
    "--host"         { $LookerHost = $args[++$i] }
    "--look"         { $LookId = $args[++$i] }
    "--client-field" { $ClientField = $args[++$i] }
    default { Write-Output "unknown option $($args[$i]). Expected --host and --look."; exit 3 }
  }
}
if (-not $LookerHost -or -not $LookId) {
  Write-Output "usage: powershell -ExecutionPolicy Bypass -File acceptance_windows.ps1 --host https://x.cloud.looker.com --look 123"
  exit 3
}`,
  `$ClientField = ""
$LookerHost = if ($env:LOOKER_HOST) { $env:LOOKER_HOST } else { Read-Host "Looker address" }
$LookId = if ($env:LOOKER_LOOK) { $env:LOOKER_LOOK } else { Read-Host "Look ID" }
if (-not $LookerHost -or -not $LookId) {
  Write-Output "A Looker address and a Look ID are both needed."
  $script:ScopeTestVerdict = 3; return
}`,
);

/* `exit` in a console session closes the window, which would take the verdict off the screen at
   the moment it is read. Inside a function, `return` leaves the function and the console stays
   open; the verdict lands in a variable so a caller can still act on it. */
ps1 = ps1.replace(
  /^(\s*)exit ([0-3])$/gm,
  "$1$script:ScopeTestVerdict = $2; return",
);
// Code lines only: several comments discuss what an exit code means, and those stay.
const survivor = ps1
  .split("\n")
  .find((l) => !l.trimStart().startsWith("#") && /(^|;)\s*exit\b/.test(l));
if (survivor)
  throw new Error(
    `make-nofile-snippet: an exit survived the rewrite: ${survivor.trim()}`,
  );

/* Comments and blank lines come out. They belong in acceptance_windows.ps1, which is where
   anybody reads this logic; here they are 10KB of extra text going through a console paste and
   a chat window, both of which mangle long blocks. Only whole-line comments are dropped, so
   nothing inside a string is touched. */
const body = ps1
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .map((l) => (l.trim() ? `  ${l}` : ""))
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .replace(/^\n+/, "")
  .trimEnd();

const snippet = `# Looker scope test, for a machine where Group Policy forbids running script files.
# Generated from scripts/acceptance_windows.ps1 - do not edit this copy.
#
# Paste the whole thing into Windows PowerShell and answer the four prompts. Nothing is saved to
# disk and no file is run, so no execution policy applies. Run it once with a Look from the
# public folder, which should end PASS, and again with one from a private folder, which should
# end INCONCLUSIVE.

function Invoke-ScopeTest {
${body}
}

$ScopeTestVerdict = 0
Invoke-ScopeTest
`;

if (process.argv.includes("--check")) {
  const committed = read(TARGET);
  if (committed !== snippet) {
    console.error(
      `  ${TARGET} is out of date with acceptance_windows.ps1.\n` +
        `  Regenerate it: node scripts/make-nofile-snippet.mjs`,
    );
    process.exit(1);
  }
  console.log("  ok    the pasteable copy matches acceptance_windows.ps1");
} else {
  writeFileSync(TARGET, snippet);
  console.log(`  wrote ${TARGET}`);
}
