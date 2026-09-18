/* A local Looker, because there is no such thing as a free one.
 *
 * Looker has no self-service trial and no public sandbox: an instance comes out of a Google
 * Cloud sales conversation, and Looker (Google Cloud core) Standard is a paid subscription. So
 * there is nothing to point `LOOKER_BASE_URL` at while building this, and waiting on a sales
 * cycle to find out whether the publisher parses a row set is absurd.
 *
 * This is a thin http shell. Everything it serves, and every way it lies, lives in
 * `mock-looker/scenarios.mjs`, shared with the copy that deploys into the stack — two copies
 * would let a passing local run say nothing about the deployed one.
 *
 *   node scripts/looker-stub.mjs                       # valid rows on :8200
 *   node scripts/looker-stub.mjs --scenario=small-cell
 *   node scripts/looker-stub.mjs --scenario=list
 *   node scripts/looker-stub.mjs --port=9000
 *   node scripts/looker-stub.mjs --access=open         # a key broader than the spec
 */

import { createServer } from "node:http";
import { ACCESS, LOOKS, SCENARIOS, respond } from "../mock-looker/scenarios.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : fallback;
};

const PORT = Number(arg("port", 8200));
const SCENARIO = arg("scenario", "valid");
// What the key may do, for rehearsing scripts/acceptance.py. The publisher sees no difference.
const POSTURE = arg("access", "scoped");

if (SCENARIO === "list") {
  console.log("\nscenarios:\n");
  for (const [name, s] of Object.entries(SCENARIOS)) {
    console.log(`  ${name.padEnd(24)} ${s.why}`);
  }
  console.log();
  process.exit(0);
}

if (!ACCESS[POSTURE]) {
  console.error(`unknown access ${POSTURE}. Known: ${Object.keys(ACCESS).join(", ")}`);
  process.exit(1);
}

if (!SCENARIOS[SCENARIO]) {
  console.error(`unknown scenario ${SCENARIO}. --scenario=list to see them.`);
  process.exit(1);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const result = respond(
      {
        method: req.method,
        path: url.pathname,
        query: url.search.slice(1),
        headers: req.headers,
        body,
      },
      SCENARIO,
      POSTURE,
    );
    console.log(`  ${result.log}`);
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(result.status === 204 ? "" : JSON.stringify(result.body));
  });
});

server.listen(PORT, () => {
  console.log(
    `\nlooker stub on http://localhost:${PORT}   scenario: ${SCENARIO}   access: ${POSTURE}`,
  );
  console.log(`  ${SCENARIOS[SCENARIO].why}`);
  console.log(
    `\nlooks: ${Object.entries(LOOKS)
      .map(([id, n]) => `${id}=${n}`)
      .join("  ")}\n`,
  );
});
