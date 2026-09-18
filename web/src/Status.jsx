/* Is it current? One row per set of figures, read straight from the distribution.
 *
 * The publisher writes `v1/data/status/<cadence>.json` on every run: the outcome and when, never
 * the reason. That file is public, and a refusal's reason can quote the very label the checks
 * exist to keep off the page — the reason stays in the function's log, inside the account.
 *
 * "Last published" and "as of" come from the data file itself rather than the status record, so
 * a refused run cannot make the page claim figures newer than the ones actually being served.
 */

import { useEffect, useState } from "react";
import { WIDGET_ORIGIN } from "./manifest.js";
import { CADENCE_ORDER } from "../../embed/content.mjs";

const OUTCOMES = {
  published: ["ok", "Published"],
  refused: [
    "bad",
    "Refused by a check. The figures still showing are the last ones that passed.",
  ],
  failed: [
    "bad",
    "Did not run through. The figures still showing are the last ones that passed.",
  ],
  skipped: ["", "No Look connected yet"],
};

// The cadences this build publishes, from the manifest rather than a copy of the list.
const cadencesOf = (manifest) => {
  const all = new Set([
    ...Object.values(manifest.cadences || {}),
    ...Object.values(manifest.also || {}).flat(),
  ]);
  const rank = (c) =>
    CADENCE_ORDER.includes(c) ? CADENCE_ORDER.indexOf(c) : 99;
  return [...all].sort((a, b) => rank(a) - rank(b));
};

// The latest as-of anywhere in a payload. Blocks carry their own, and they can differ.
const latestAsOf = (node) => {
  if (!node || typeof node !== "object") return null;
  let best = typeof node.asOf === "string" ? node.asOf : null;
  for (const v of Object.values(node)) {
    const found = latestAsOf(v);
    if (found && (!best || found > best)) best = found;
  }
  return best;
};

const read = (path) =>
  fetch(`${WIDGET_ORIGIN}/${path}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

const ago = (iso) => {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, n] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ])
    if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
  return "just now";
};

const stamp = (iso) =>
  iso ? (
    <time dateTime={iso} title={new Date(iso).toLocaleString()}>
      {ago(iso)}
    </time>
  ) : (
    "—"
  );

const day = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

export default function Status({ manifest }) {
  const [rows, setRows] = useState(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      Promise.all(
        cadencesOf(manifest).map(async (cadence) => {
          const [status, data] = await Promise.all([
            read(`v1/data/status/${cadence}.json`),
            read(`v1/data/${cadence}.json`),
          ]);
          return { cadence, status, data };
        }),
      ).then((r) => live && setRows(r));
    load();
    const timer = setInterval(load, 60000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [manifest]);

  return (
    <section>
      <h2>Is it current</h2>
      <p>
        Each set of figures is published on its own schedule. This is what the
        publisher last recorded, read from <code>{WIDGET_ORIGIN}</code>, and it
        refreshes every minute.
      </p>

      {!rows ? (
        <p>Reading…</p>
      ) : (
        <table className="status">
          <thead>
            <tr>
              <th>Figures</th>
              <th>Last run</th>
              <th>Result</th>
              <th>Last published</th>
              <th>Figures as of</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ cadence, status, data }) => {
              const [tone, words] = status
                ? OUTCOMES[status.outcome] || ["bad", status.outcome]
                : ["", "Never run"];
              return (
                <tr key={cadence}>
                  <td>
                    <code>{cadence}</code>
                  </td>
                  <td>{stamp(status?.at)}</td>
                  <td className={tone}>{words}</td>
                  <td>{stamp(data?.meta?.generated)}</td>
                  <td>{day(latestAsOf(data))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
