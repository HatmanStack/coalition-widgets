#!/usr/bin/env node
/* Deploy the stack, then build and publish the bundle.
 *
 *   npm run deploy                     everything
 *   npm run deploy -- --dry-run        preflight and print what it would run
 *   npm run deploy -- --skip-bundle    stack only
 *
 * Order is forced, not a preference. The bundle bakes in the data origin at build time, and the
 * origin is the CloudFront hostname, which does not exist until the stack does. So: deploy,
 * read the hostname, start the build against it.
 */

import { spawnSync } from "child_process";
import { createInterface } from "readline";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGION = "us-east-1";
const CONFIG = join(ROOT, ".deploy.json");

const DRY = process.argv.includes("--dry-run");
const SKIP_BUNDLE = process.argv.includes("--skip-bundle");
const YES = process.argv.includes("--yes");
const flag = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const line = (t) => console.log(`\n${"-".repeat(72)}\n  ${t}\n${"-".repeat(72)}`);
const ok = (m) => console.log(`  ok    ${m}`);
const die = (m) => {
  console.error(`\n  ${m}\n`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf-8", ...opts });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}
const stream = (cmd, args) => spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" }).status;

const ask = (q, d = "") =>
  new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(d ? `${q} [${d}]: ` : `${q}: `, (a) => {
      rl.close();
      res(a.trim() || d);
    });
  });

// ---------------------------------------------------------------------------- preflight

line("Preflight");
const config = existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, "utf-8")) : {};
const profile = flag("profile") || config.profile || "dev";
const stack = flag("stack") || config.stack || "coalition-widgets";

const identity = run("aws", ["sts", "get-caller-identity", "--profile", profile, "--output", "json"]);
if (identity.code !== 0) {
  die(`No valid session for profile "${profile}". This uses SSO, so run:\n\n      aws sso login --profile ${profile}`);
}
ok(`AWS account ${JSON.parse(identity.out).Account}`);

for (const [cmd, args] of [["sam", ["--version"]], ["node", ["--version"]]]) {
  const r = run(cmd, args);
  if (r.code !== 0) die(`${cmd} not found on PATH`);
  ok(r.out);
}

const validate = run("sam", ["validate", "--lint", "--region", REGION]);
if (validate.code !== 0) die(`sam validate failed:\n\n${validate.out}`);
ok("sam validate --lint");

// ---------------------------------------------------------------------------- looker config

line("Looker");
const looker = {
  base: flag("looker-url") || config.lookerBase || (await ask("Looker base URL, e.g. https://x.cloud.looker.com", config.lookerBase || "")),
  quarterly: flag("quarterly-look") || config.quarterly || (await ask("Quarterly measures Look ID", config.quarterly || "")),
  live: flag("live-look") || config.live || (await ask("Live queue Look ID, blank to skip", config.live || "")),
  race: config.race || (await ask("Race and ethnicity Look ID, blank to skip", config.race || "")),
  shelter: config.shelter || (await ask("Shelter status Look ID, blank to skip", config.shelter || "")),
};
if (!looker.base) die("A Looker base URL is required; the function has nothing to read without it.");

writeFileSync(
  CONFIG,
  `${JSON.stringify({ profile, stack, lookerBase: looker.base, quarterly: looker.quarterly, live: looker.live, race: looker.race, shelter: looker.shelter }, null, 2)}\n`,
);
ok(`wrote ${CONFIG}`);

const overrides = [
  `LookerBaseUrl=${looker.base}`,
  `QuarterlyLookId=${looker.quarterly}`,
  `LiveLookId=${looker.live}`,
  `RaceEthnicityLookId=${looker.race}`,
  `ShelterStatusLookId=${looker.shelter}`,
];

if (DRY) {
  line("Dry run");
  console.log(`  Would run: sam deploy --stack-name ${stack} --parameter-overrides ${overrides.join(" ")}`);
  process.exit(0);
}

if (!YES) {
  const go = await ask('\n  Deploy? The bucket and distribution are Retain, so the hostname survives a teardown. Type "yes"');
  if (go.toLowerCase() !== "yes") die("Stopped.");
}

// ---------------------------------------------------------------------------- deploy

line("sam build");
if (stream("sam", ["build"]) !== 0) die("sam build failed");

line("sam deploy");
const deployed = stream("sam", [
  "deploy",
  "--stack-name", stack,
  "--region", REGION,
  "--profile", profile,
  "--capabilities", "CAPABILITY_IAM",
  "--resolve-s3",
  "--no-fail-on-empty-changeset",
  "--parameter-overrides", ...overrides,
]);
if (deployed !== 0) die("sam deploy failed");

const outRaw = run("aws", [
  "cloudformation", "describe-stacks",
  "--stack-name", stack, "--region", REGION, "--profile", profile,
  "--query", "Stacks[0].Outputs", "--output", "json",
]);
if (outRaw.code !== 0) die(`Could not read stack outputs:\n\n${outRaw.out}`);
const outputs = Object.fromEntries(JSON.parse(outRaw.out).map((o) => [o.OutputKey, o.OutputValue]));
writeFileSync(join(ROOT, ".deploy-outputs.json"), `${JSON.stringify(outputs, null, 2)}\n`);

line("Stack outputs");
for (const [k, v] of Object.entries(outputs)) console.log(`  ${k.padEnd(24)} ${v}`);

// ---------------------------------------------------------------------------- bundle

if (SKIP_BUNDLE) {
  line("Bundle skipped");
  process.exit(0);
}

line("Bundle");
const origin = `https://${outputs.DistributionDomainName}`;
console.log(`  Building in CodeBuild against ${origin}\n`);

const started = run("aws", [
  "codebuild", "start-build",
  "--project-name", outputs.BundleBuildProject,
  "--region", REGION, "--profile", profile,
  "--query", "build.id", "--output", "text",
]);
if (started.code !== 0) {
  console.log(
    `  CodeBuild could not start: ${started.out}\n\n` +
      `  Most likely the GitHub source is not connected yet. Connect it once in the console,\n` +
      `  or build locally instead:\n\n` +
      `      node embed/build.mjs --origin ${origin}\n` +
      `      aws s3 cp dist/chc.*.js s3://${outputs.BucketName}/v1/ --profile ${profile}\n`,
  );
  process.exit(0);
}
ok(`build ${started.out}`);
console.log(
  `\n  Watch it:\n\n      aws codebuild batch-get-builds --ids ${started.out} --region ${REGION} --profile ${profile} \\\n        --query 'builds[0].buildStatus' --output text\n\n` +
    `  When it finishes, the embed tag is at ${origin}/v1/manifest.json\n`,
);
