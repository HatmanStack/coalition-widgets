/* A fake Looker with a public address, so a deployed stack can be tested end to end.
 *
 * There is no free Looker instance to point a deployed Lambda at, and a deployed Lambda cannot
 * reach a server on somebody's laptop. That leaves three options: a tunnel from a local stub,
 * `sam local invoke` against localhost, or a mock that lives in the stack. Only the third
 * exercises the thing being deployed — the real function, the real role, the real network path,
 * the real bucket — which is the only reason to deploy at all.
 *
 * It is off by default and gated on `MockLooker=true`. Turning it on creates an unauthenticated
 * Function URL. Everything it serves is invented and matches no real person or period, but it
 * is still a public endpoint and it does not belong in a production stack.
 *
 * `SCENARIO` selects what it lies about, so the deployed publisher can be watched refusing:
 * set it to `small-cell`, invoke, and the alarm should fire with nothing written.
 */

import { SCENARIOS, respond } from "./scenarios.mjs";

const SCENARIO = process.env.SCENARIO || "valid";

export const handler = async (event) => {
  if (!SCENARIOS[SCENARIO]) {
    // A typo'd scenario silently serving valid rows would make a hostile test look like it
    // passed, which is the one failure this whole mock exists to avoid.
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: `unknown SCENARIO ${SCENARIO}. Known: ${Object.keys(SCENARIOS).join(", ")}`,
      }),
    };
  }

  const http = event.requestContext?.http || {};
  // Function URLs lowercase header names, but nothing in the contract promises that, and the
  // shared responder is also driven by a Node http server where casing is preserved.
  const headers = {};
  for (const [k, v] of Object.entries(event.headers || {}))
    headers[k.toLowerCase()] = v;

  const body = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf-8")
    : event.body || "";

  const result = respond(
    {
      method: http.method,
      path: event.rawPath || "/",
      query: event.rawQueryString || "",
      headers,
      body,
    },
    SCENARIO,
  );

  // One line per request into CloudWatch, so a failed publish can be read against what the mock
  // actually served rather than what it was configured to serve.
  console.log(
    JSON.stringify({ scenario: SCENARIO, ...result, body: undefined }),
  );

  return {
    statusCode: result.status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result.body),
  };
};
