/* One fetch and one timer per cadence file, however many widgets are on the same pane.
 *
 * Per pane, not per page: `files` below is module state and the bundle is an IIFE, so every
 * <script> execution gets its own copy. Two tags on one page each read the files they need and
 * the browser's cache serves the repeat — measured as two entries for quarterly.json in the
 * resource timeline, not one.
 *
 * Widgets subscribe on mount and unsubscribe on unmount. A failed poll keeps the last good
 * render and raises a staleness flag rather than blanking the page or silently showing old
 * numbers as current. */

/* eslint-disable no-undef */
// Bare identifiers, replaced by esbuild `define` at build time. Writing these as string
// literals silently does nothing: define substitutes identifiers, not string contents, so the
// bundle shipped fetching a relative "__DATA_ORIGIN__/..." path. The tell was two different
// origins producing the same hash.
const DATA_ORIGIN = __DATA_ORIGIN__;

const POLL = {
  live: 60_000,
  weekly: 3_600_000,
  monthly: 3_600_000,
  quarterly: 3_600_000,
  annual: 3_600_000,
};

const files = new Map(); // cadence -> { data, error, stale, subscribers, timer }

function state(cadence) {
  if (!files.has(cadence)) {
    files.set(cadence, {
      data: null,
      error: null,
      stale: false,
      subs: new Set(),
      timer: null,
    });
  }
  return files.get(cadence);
}

function emit(cadence) {
  const f = state(cadence);
  for (const fn of f.subs) fn(f);
}

async function load(cadence) {
  const f = state(cadence);
  const url = `${DATA_ORIGIN}/v1/data/${cadence}.json`;
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) {
      // S3 answers an absent key with 403 rather than 404 when the reader cannot list the
      // bucket, which is exactly how this distribution is configured. Reported bare, that
      // sends whoever reads it looking for a permissions problem, when what it almost always
      // means is that this cadence has never been published.
      const hint =
        response.status === 403 || response.status === 404
          ? " This file has probably never been published."
          : "";
      throw new Error(`HTTP ${response.status}.${hint}`);
    }
    f.data = await response.json();
    f.error = null;
    f.stale = false;
  } catch (err) {
    // Keep the last good data. A widget that blanked on a transient network error would be
    // worse than one that says plainly that it is showing something older.
    f.error = err.message || String(err);
    f.stale = f.data !== null;
  }
  emit(cadence);
}

export function subscribe(cadence, fn) {
  const f = state(cadence);
  f.subs.add(fn);
  if (f.data || f.error) fn(f);
  if (!f.timer) {
    load(cadence);
    const every = POLL[cadence] || POLL.quarterly;
    f.timer = setInterval(() => load(cadence), every);
  }
  return () => {
    f.subs.delete(fn);
    if (f.subs.size === 0 && f.timer) {
      clearInterval(f.timer);
      f.timer = null;
    }
  };
}

export const origin = () => DATA_ORIGIN;
