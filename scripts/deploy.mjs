#!/usr/bin/env node
/* Deploy the stack, then build and publish the bundle.
 *
 *   npm run deploy                     everything
 *   npm run deploy -- --dry-run        preflight and print what it would run
 *   npm run deploy -- --skip-bundle    stack only
 *   npm run deploy -- --mock           with a fake Looker deployed alongside
 *   npm run deploy -- --mock --scenario small-cell    …one that the publisher must refuse
 *
 *   npm run deploy -- --profile uwp --looker-url https://x.cloud.looker.com \
 *                     --look-id Quarterly=123 --look-id County=456        a real Looker
 *
 * Order is forced, not a preference. The bundle bakes in the data origin at build time, and the
 * origin is the CloudFront hostname, which does not exist until the stack does. So: deploy,
 * read the hostname, start the build against it.
 */

import { spawnSync } from "child_process";
import { createServer } from "http";
import { createInterface } from "readline";
import { existsSync, readFileSync, writeFileSync, rmSync, statSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGION = "us-east-1";
const CONFIG = join(ROOT, ".deploy.json");
// Not 8080: `npm run dev` holds that, and the two are useful side by side — one serving the
// local build, one serving the deployed one.
const TEST_PORT =
  Number(process.argv[process.argv.indexOf("--test-port") + 1]) || 8787;

const DRY = process.argv.includes("--dry-run");
const SKIP_BUNDLE = process.argv.includes("--skip-bundle");
const YES = process.argv.includes("--yes");
const flag = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const line = (t) =>
  console.log(`\n${"-".repeat(72)}\n  ${t}\n${"-".repeat(72)}`);
const ok = (m) => console.log(`  ok    ${m}`);
const warn = (m) => console.log(`  !!    ${m}`);
const die = (m) => {
  console.error(`\n  ${m}\n`);
  process.exit(1);
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf-8", ...opts });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}
const stream = (cmd, args) =>
  spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit" }).status;

const ask = (q, d = "") =>
  new Promise((res) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(d ? `${q} [${d}]: ` : `${q}: `, (a) => {
      rl.close();
      res(a.trim() || d);
    });
  });

// ---------------------------------------------------------------------------- preflight

line("Preflight");
/* The account is named on the command line every time, never remembered. `.deploy.json` used to
 * carry one `profile`, so the first deploy into a second account would have made it the default
 * for every deploy after — including `--mock`, which on the same stack name repoints a real
 * publisher at invented figures. What is saved is kept per profile for the same reason: a Look
 * ID or a base URL means something only in the account it was given for. */
const profile = flag("profile") || "dev";
const saved = existsSync(CONFIG)
  ? JSON.parse(readFileSync(CONFIG, "utf-8"))
  : {};
const config = saved[profile] || {};
const stack = flag("stack") || config.stack || "coalition-widgets";
const MOCK = process.argv.includes("--mock");

const identity = run("aws", [
  "sts",
  "get-caller-identity",
  "--profile",
  profile,
  "--output",
  "json",
]);
if (identity.code !== 0) {
  die(
    `No valid session for profile "${profile}". This uses SSO, so run:\n\n      aws sso login --profile ${profile}`,
  );
}
ok(`AWS account ${JSON.parse(identity.out).Account} (profile ${profile})`);

/* A stack is mock or real for its whole life. Flipping a real one to --mock points its publisher
   at invented figures under the distribution partners already load, and nothing on their pages
   would say so. A different stack name is the way to have both. */
const existing = run("aws", [
  "cloudformation",
  "describe-stacks",
  "--stack-name",
  stack,
  "--region",
  REGION,
  "--profile",
  profile,
  "--query",
  "Stacks[0].Parameters[?ParameterKey=='MockLooker'].ParameterValue",
  "--output",
  "text",
]);
if (existing.code === 0) {
  const wasMock = existing.out.trim() === "true";
  if (wasMock !== MOCK)
    die(
      `Stack ${stack} is ${wasMock ? "a mock" : "a real"} deployment and this is ${MOCK ? "--mock" : "not --mock"}.\n` +
        `      Refusing to switch it. Use --stack <another-name> for a separate one.`,
    );
  ok(`stack ${stack} exists, ${wasMock ? "mock" : "real"}`);
} else if (/does not exist/.test(existing.out)) {
  ok(`stack ${stack} is new`);
} else {
  die(`Could not read stack ${stack}:\n\n${existing.out}`);
}

for (const [cmd, args] of [
  ["sam", ["--version"]],
  ["node", ["--version"]],
]) {
  const r = run(cmd, args);
  if (r.code !== 0) die(`${cmd} not found on PATH`);
  ok(r.out);
}

const validate = run("sam", ["validate", "--lint", "--region", REGION]);
if (validate.code !== 0) die(`sam validate failed:\n\n${validate.out}`);
ok("sam validate --lint");

// ---------------------------------------------------------------------------- looker config

line("Looker");

// --mock deploys a fake Looker into the stack and points the publisher at it. Nothing to ask
// for: the base URL is the mock's own Function URL, resolved by the template, and the Look IDs
// are the mock's. It exists because there is no free Looker instance to test a deployment
// against, and a deployed Lambda cannot reach a stub on this machine.
const SCENARIO = flag("scenario") || "valid";

let overrides;
if (MOCK) {
  warn(
    "Deploying with a MOCK Looker. This creates an unauthenticated Function URL serving",
  );
  warn(
    "invented data, and the publisher will read from it rather than a real instance.",
  );
  ok(
    `scenario: ${SCENARIO}${SCENARIO === "valid" ? "" : " — the publisher is expected to refuse"}`,
  );
  overrides = [`MockLooker=true`, `MockScenario=${SCENARIO}`];
} else {
  /* Every Look ID the template takes, read from the template rather than listed here. This used
     to ask for four of the thirteen, so a stack could not be pointed at a county or an annual
     Look at all. A Look left unset is skipped by the publisher, not refused, so a stack can go
     live one Look at a time. */
  const NAMES = [
    ...readFileSync(join(ROOT, "template.yaml"), "utf-8").matchAll(
      /^  (\w+)LookId:/gm,
    ),
  ].map((m) => m[1]);
  const looks = { ...(config.looks || {}) };
  process.argv.forEach((a, i) => {
    if (a !== "--look-id") return;
    const [name, id] = (process.argv[i + 1] || "").split("=");
    if (!NAMES.includes(name) || !id)
      die(
        `--look-id ${process.argv[i + 1] || ""}: expected Name=ID, one of\n\n      ${NAMES.join(", ")}`,
      );
    looks[name] = id;
  });

  const base =
    flag("looker-url") ||
    config.lookerBase ||
    (await ask("Looker base URL, e.g. https://x.cloud.looker.com"));
  if (!base)
    die(
      "A Looker base URL is required; the function has nothing to read without it.\n\n      To test without one: npm run deploy -- --mock",
    );
  // The publisher refuses anything else at run time. Refusing it here saves a deploy.
  if (!base.startsWith("https://"))
    die(`The Looker base URL must start with https://, got ${base}`);
  ok(`Looker ${base}`);
  for (const name of NAMES)
    console.log(`        ${name.padEnd(14)} ${looks[name] || "-"}`);
  if (!Object.values(looks).some(Boolean))
    warn(
      "No Look IDs yet. Every run is skipped until one is set: --look-id Quarterly=123",
    );

  // Not on a dry run: it would change what the next real deploy targets without deploying.
  if (!DRY) {
    writeFileSync(
      CONFIG,
      `${JSON.stringify({ ...saved, [profile]: { stack, lookerBase: base, looks } }, null, 2)}\n`,
    );
    ok(`saved under "${profile}" in ${CONFIG}`);
  }

  // Only the IDs that are set. On an update SAM keeps the previous value of any parameter not
  // passed, and on a create the template's empty default applies.
  overrides = [
    `MockLooker=false`,
    `LookerBaseUrl=${base}`,
    ...NAMES.filter((n) => looks[n]).map((n) => `${n}LookId=${looks[n]}`),
  ];
}

if (DRY) {
  line("Dry run");
  console.log(
    `  Would run: sam deploy --stack-name ${stack} --parameter-overrides ${overrides.join(" ")}`,
  );
  process.exit(0);
}

if (!YES) {
  const go = await ask(
    '\n  Deploy? The bucket and distribution are Retain, so the hostname survives a teardown. Type "yes"',
  );
  if (go.toLowerCase() !== "yes") die("Stopped.");
}

// ---------------------------------------------------------------------------- deploy

line("sam build");
if (stream("sam", ["build"]) !== 0) die("sam build failed");

line("sam deploy");
const deployed = stream("sam", [
  "deploy",
  "--stack-name",
  stack,
  "--region",
  REGION,
  "--profile",
  profile,
  "--capabilities",
  "CAPABILITY_IAM",
  "--resolve-s3",
  "--no-fail-on-empty-changeset",
  "--parameter-overrides",
  ...overrides,
]);
if (deployed !== 0) die("sam deploy failed");

const outRaw = run("aws", [
  "cloudformation",
  "describe-stacks",
  "--stack-name",
  stack,
  "--region",
  REGION,
  "--profile",
  profile,
  "--query",
  "Stacks[0].Outputs",
  "--output",
  "json",
]);
if (outRaw.code !== 0) die(`Could not read stack outputs:\n\n${outRaw.out}`);
const outputs = Object.fromEntries(
  JSON.parse(outRaw.out).map((o) => [o.OutputKey, o.OutputValue]),
);
writeFileSync(
  join(ROOT, ".deploy-outputs.json"),
  `${JSON.stringify(outputs, null, 2)}\n`,
);

line("Stack outputs");
for (const [k, v] of Object.entries(outputs))
  console.log(`  ${k.padEnd(24)} ${v}`);

// ---------------------------------------------------------------------------- bundle

if (SKIP_BUNDLE) {
  line("Bundle skipped");
  process.exit(0);
}

line("Bundle");
const origin = `https://${outputs.DistributionDomainName}`;

/* Ship the working tree to S3 and build from that.
 *
 * CodeBuild used to clone GitHub, which meant the bundle could only ever be built from a pushed
 * commit in a repository whose source connection had been authorised by hand in the console.
 * Neither had happened, so every build failed at DOWNLOAD_SOURCE while this script caught the
 * error and printed a local fallback — the bundle silently never built, and nobody noticed
 * because the deploy still reported success.
 *
 * From a zip there is no remote, no connection step, and no question about which commit was
 * built: it is the code sitting in this directory right now.
 *
 * Only what the buildspec reads. node_modules, dist, .git and the local AWS state are excluded
 * because `npm ci` reinstalls from the lockfile, and a zip carrying .deploy.json would put a
 * developer's local configuration into a build artifact. */
const ZIP = join(ROOT, ".build-source.zip");
const SOURCE_KEY = "build/source.zip";

rmSync(ZIP, { force: true });
const zipped = run("zip", [
  "-q",
  "-r",
  ZIP,
  "embed",
  "package.json",
  "package-lock.json",
  "-x",
  "embed/test/*",
  "*/node_modules/*",
]);
if (zipped.code !== 0) die(`Could not build the source zip:\n\n${zipped.out}`);
ok(`${SOURCE_KEY} (${(statSync(ZIP).size / 1024).toFixed(0)} KB)`);

const uploaded = run("aws", [
  "s3",
  "cp",
  ZIP,
  `s3://${outputs.BucketName}/${SOURCE_KEY}`,
  "--region",
  REGION,
  "--profile",
  profile,
]);
rmSync(ZIP, { force: true });
if (uploaded.code !== 0) die(`Could not upload the source:\n\n${uploaded.out}`);
ok(`uploaded to s3://${outputs.BucketName}/${SOURCE_KEY}`);

console.log(`\n  Building in CodeBuild against ${origin}\n`);

const started = run("aws", [
  "codebuild",
  "start-build",
  "--project-name",
  outputs.BundleBuildProject,
  "--region",
  REGION,
  "--profile",
  profile,
  "--query",
  "build.id",
  "--output",
  "text",
]);
if (started.code !== 0) {
  // A failure here is fatal, not a note. The previous version printed a fallback and exited 0,
  // so a deploy that published no bundle at all still looked like it had worked.
  die(
    `CodeBuild could not start:\n\n${started.out}\n\n` +
      `      To build locally instead:\n\n` +
      `      node embed/build.mjs --origin ${origin}`,
  );
}
ok(`build ${started.out}`);

/* Wait for it. A deploy is not finished when a build has been *asked for* — the bundle is the
   thing partners load, and reporting success while it is still compiling means the next step
   reads a manifest that is not there yet, or worse, the previous one. */
const buildStatus = () =>
  run("aws", [
    "codebuild",
    "batch-get-builds",
    "--ids",
    started.out,
    "--region",
    REGION,
    "--profile",
    profile,
    "--query",
    "builds[0].buildStatus",
    "--output",
    "text",
  ]).out.trim();

process.stdout.write("  waiting ");
let status = "IN_PROGRESS";
for (let i = 0; i < 100 && status === "IN_PROGRESS"; i++) {
  spawnSync("sleep", ["6"]);
  process.stdout.write(".");
  status = buildStatus();
}
console.log();
if (status !== "SUCCEEDED") {
  die(
    `CodeBuild finished ${status}. Logs:\n\n` +
      `      aws codebuild batch-get-builds --ids ${started.out} --region ${REGION} \\\n` +
      `        --profile ${profile} --query 'builds[0].logs.deepLink' --output text`,
  );
}
ok(`build SUCCEEDED`);

// ---------------------------------------------------------------------------- mock: prove it

if (!MOCK) {
  line("Next");
  console.log(`  The embed tag is at ${origin}/v1/manifest.json\n`);
  console.log(
    `  The key goes in with the acceptance test, which stores it only on a PASS:\n`,
  );
  console.log(`      python3 acceptance.py --host <looker> --look <id> \\`);
  console.log(`        --secret ${outputs.LookerSecretArn}\n`);
  console.log(`  Then publish one cadence and read what it says:\n`);
  console.log(
    `      aws lambda invoke --function-name ${outputs.PublisherFunctionName} \\\n` +
      `        --payload '{"cadence":"quarterly"}' --cli-binary-format raw-in-base64-out \\\n` +
      `        --region ${REGION} --profile ${profile} /dev/stdout\n`,
  );
  process.exit(0);
}

/* In mock mode the point of deploying is to look at the result, so the last steps are the ones
   that turn a stack into something on a screen: put data in the bucket, read back the tag the
   build actually published, and write a page that loads it from CloudFront. */
line("Publishing data through the mock");
/* Ask the publisher what it publishes rather than keeping a second list here.
 *
 * This was hardcoded to ["quarterly", "live"]. Adding the annual cadence to contract.py left it
 * behind, so annual.json was never written and every annual widget on the test page showed
 * CHC-03 — while the deploy reported success. Same shape as the widget list two steps earlier:
 * a copy of a registry that nothing forces to stay in step with it. */
const cadenceProbe = run("python3", [
  "-c",
  "import sys; sys.path.insert(0, 'publisher'); import contract; print(' '.join(contract.CADENCES))",
]);
if (cadenceProbe.code !== 0)
  die(
    `Could not read the cadences from publisher/contract.py:\n\n${cadenceProbe.out}`,
  );
const CADENCES = cadenceProbe.out.trim().split(/\s+/);
ok(`cadences: ${CADENCES.join(", ")}`);

for (const cadence of CADENCES) {
  const invoked = run("aws", [
    "lambda",
    "invoke",
    "--function-name",
    outputs.PublisherFunctionName,
    "--payload",
    JSON.stringify({ cadence }),
    "--cli-binary-format",
    "raw-in-base64-out",
    "--region",
    REGION,
    "--profile",
    profile,
    "/dev/stdout",
  ]);
  const refused = invoked.out.includes("errorMessage");
  // A refusal is the expected outcome for a hostile scenario, so it is reported rather than
  // fatal. Nothing was written, which is the behaviour being tested.
  if (refused) {
    warn(
      `${cadence}: refused — ${(invoked.out.match(/"errorMessage":\s*"([^"]+)"/) || [])[1] || "see logs"}`,
    );
  } else {
    ok(`${cadence}: published`);
  }
}

line("Test page");
const manifestRaw = run("curl", [
  "-s",
  "-m",
  "20",
  `${origin}/v1/manifest.json`,
]);
let manifest;
try {
  manifest = JSON.parse(manifestRaw.out);
} catch {
  die(`Could not read ${origin}/v1/manifest.json:\n\n${manifestRaw.out}`);
}
ok(`${manifest.file}  ${manifest.gzip} bytes gzipped`);

const page = join(ROOT, ".deploy-test.html");
const tag = (layout, widgets) =>
  `<script src="${origin}/${manifest.file}"\n        integrity="${manifest.integrity}"\n` +
  `        crossorigin="anonymous" defer\n        data-layout="${layout}"\n` +
  `        data-widgets="${widgets}"></script>`;

/* Every widget, always, from the manifest the build just published.
 *
 * It used to list the five that had data, which made a page showing five of eleven look like the
 * complete set — the same silent narrowing the bundle's error codes exist to prevent. Then it
 * listed eleven while the catalogue held thirteen, so the page written to prove a deploy omitted
 * the two newest widgets: exactly the two most likely to be broken by it.
 *
 * Refused rather than defaulted. `manifest.widgets || []` turns a manifest that never carried
 * the field into a page mounting nothing at all, which renders clean and verifies precisely
 * nothing — a guard reading a proxy instead of the signal. */
if (!Array.isArray(manifest.widgets) || manifest.widgets.length === 0) {
  die(
    `The manifest at ${origin}/v1/manifest.json carries no widget list, so the page that
` +
      `      proves this deploy would mount nothing and pass. Rebuild the bundle: embed/build.mjs
` +
      `      writes the catalogue into the manifest.`,
  );
}
const ALL_WIDGETS = manifest.widgets.join(",");

writeFileSync(
  page,
  `<!doctype html>
<meta charset="utf-8"><meta name="robots" content="noindex, nofollow">
<title>coalition widgets — ${stack}</title>
<style>
  body { font: 15px/1.6 system-ui, sans-serif; margin: 0; background: #f4f6fa; color: #12161f; }
  header, section { padding: 24px 32px; }
  header { background: #fff; border-bottom: 1px solid #e2e6ef; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  h2 { font: 600 11px ui-monospace, monospace; text-transform: uppercase; letter-spacing: .08em; color: #767e90; margin: 0 0 12px; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 16px; font: 12px ui-monospace, monospace; margin: 12px 0 0; }
  dt { color: #767e90; }
  dd { margin: 0; word-break: break-all; }
  pre { background: #12161f; color: #e6e9ef; padding: 12px 14px; border-radius: 6px; font: 12px/1.55 ui-monospace, monospace; overflow-x: auto; }
  .dark { background: #14161a; }
  .warn { background: #fff4e5; border-left: 3px solid #eb6834; padding: 10px 14px; margin-top: 12px; font-size: 13px; }
</style>

<header>
  <h1>${stack} — deployed with a mock Looker</h1>
  <p style="margin:0;color:#4a5265">Scenario <b>${SCENARIO}</b>. Every figure below is invented and matches no real person or period.</p>
  <div class="warn">
    This stack reads <b>${outputs.MockLookerUrl || "a mock"}</b>, not a real Looker instance.
    Its presence in the stack outputs is how you know.
  </div>
  <dl>
${Object.entries(outputs)
  .map(([k, v]) => `    <dt>${k}</dt><dd>${v}</dd>`)
  .join("\n")}
    <dt>bundle</dt><dd>${manifest.file} (${manifest.gzip} bytes gzipped)</dd>
  </dl>
</header>

<section>
  <h2>data-layout="cards" — a card per statistic</h2>
  ${tag("cards", ALL_WIDGETS)}
</section>

<section class="dark">
  <h2 style="color:#838b9c">the same tag on a dark background</h2>
  ${tag("cards", "active-count,queue-total")}
</section>

<section>
  <h2>data-layout="dashboard" — packed</h2>
  ${tag("dashboard", ALL_WIDGETS)}
</section>

<section>
  <h2>the tag itself</h2>
  <pre>${tag("cards", ALL_WIDGETS).replace(/</g, "&lt;")}</pre>
</section>
`,
);
ok(`wrote ${page}`);

/* Serve it rather than opening the file.
 *
 * `file://` does render — the bundle loads and the cards draw — so this is not a workaround for
 * something broken. It is that a partner's page is served over HTTP and a file URL is not the
 * same environment: its origin is `null`, it carries no referrer, and it is exempt from the
 * mixed-content and CSP rules that a real host page is subject to. Testing the embed somewhere
 * those rules do not apply is testing a situation no partner is ever in.
 *
 * On localhost the browser makes genuinely cross-origin requests to CloudFront for the bundle,
 * its SRI check and the data, which is exactly the shape of a partner's page. */
const server = createServer((_req, res) => {
  res
    .writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    })
    .end(readFileSync(page));
});

server.listen(TEST_PORT, () => {
  const url = `http://localhost:${TEST_PORT}/`;
  // Best effort. A headless or remote shell has nothing to open, and that is not a failure.
  for (const opener of ["xdg-open", "open"]) {
    if (run("which", [opener]).code === 0) {
      spawnSync(opener, [url], { stdio: "ignore", detached: true });
      break;
    }
  }
  line("Serving");
  console.log(`  ${url}`);
  console.log(
    `\n  Loading the bundle and the data cross-origin from ${origin},`,
  );
  console.log(`  which is the same thing a partner's page does.\n`);
  console.log(`  Ctrl-C to stop.\n`);
});
