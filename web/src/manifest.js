/* Where the widgets live, and what may be asked of them.
 *
 * The bundle, the manifest and the data are served by the CloudFront distribution. This site is
 * only pages: nothing here is copied from the widget build, it is read from it at runtime.
 *
 * `manifest.json` carries `params` and `widgets` — the same `ALLOWED` and `NAMES` the bundle
 * itself enforces, written there by embed/build.mjs. Reading them means a widget added to the
 * catalogue appears in this builder with no change here, and a parameter added to the registry
 * gets a control. Seven hand-maintained copies of those two lists have drifted in this project
 * already; this is deliberately not the eighth.
 */

import { useEffect, useState } from "react";

/* The deployed distribution, in development as well as in a build. Set in web/.env.
 *
 * This used to fall back to http://localhost:8080 whenever the variable was unset, which meant
 * the ordinary way to work on the site produced a page whose whole purpose — handing somebody a
 * tag to paste — printed a localhost URL that works on no other machine. Pointing at the real
 * distribution by default costs nothing: it is public, it is cached, and it is what a partner
 * loads.
 *
 * To work against a bundle built on this machine instead, put the local origin in
 * `web/.env.local`, which git ignores and Vite prefers:
 *
 *     VITE_WIDGET_ORIGIN=http://localhost:8080
 *
 * No fallback: an unset variable interpolates as "undefined" into every URL on the page, and
 * a site that fetches `undefined/v1/manifest.json` should say so rather than look broken. */
export const WIDGET_ORIGIN = import.meta.env.VITE_WIDGET_ORIGIN;

/* The reference an assistant reads, which this site serves itself.
 *
 * It used to be fetched from the distribution alongside the bundle, and both links here pointed
 * there. It is prose about what the tag accepts rather than anything the widgets load, it is
 * deployed whenever these pages are, and it is written by hand — so it lives in `web/public` and
 * is served from this origin.
 *
 * Two forms, because the two uses are not the same. A link on the page wants the path, so it
 * follows the site wherever it is deployed. Somebody pasting the address into a chat window
 * needs an absolute URL, and it has to be this site's — resolved at call time rather than at
 * module scope so nothing here depends on `location` existing. */
export const LLM_TXT = "/llm.txt";
export const llmTxtUrl = () => new URL(LLM_TXT, location.href).href;

export function useManifest() {
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let live = true;
    if (!WIDGET_ORIGIN) {
      setState({
        status: "error",
        detail:
          "VITE_WIDGET_ORIGIN is not set. web/.env names the distribution that serves the bundle.",
      });
      return undefined;
    }
    fetch(`${WIDGET_ORIGIN}/v1/manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((manifest) => {
        if (!live) return;
        /* A manifest without these is an older build, not an empty catalogue. Rendering a
           builder with no widgets and no parameters would look like the widgets had gone away;
           saying which build is being read is the difference between a puzzle and a fix. */
        /* The shape, not just the presence. `params` used to be {attr: [values]} and is now
           {attr: {default, values}}; read the old shape with the new code and every control
           renders with no options at all and nothing thrown — `Array.prototype.values` is a
           function, and Object.entries of a function is []. A silently empty control is the
           worst outcome available here, so it is checked for by name. */
        const shaped =
          manifest.params &&
          Object.values(manifest.params).every(
            (spec) => spec && typeof spec === "object" && !Array.isArray(spec),
          );
        if (!manifest.params || !manifest.widgets || !shaped) {
          setState({
            status: "stale",
            manifest,
            detail:
              "The manifest at this origin predates the registry this page reads. Redeploy the " +
              "widget bundle and this page fills itself in.",
          });
          return;
        }
        setState({ status: "ready", manifest });
      })
      .catch((error) => {
        if (live) setState({ status: "error", detail: String(error.message) });
      });
    return () => {
      live = false;
    };
  }, []);

  return state;
}

/* The tag a partner pastes. Assembled from the manifest rather than written out, so the src and
   the integrity hash are the ones actually serving — a tag typed into documentation is stale the
   next time the bundle is built, and a stale integrity hash fails closed and renders nothing. */
export function tagFor(manifest, attrs) {
  const lines = Object.entries(attrs).map(([k, v]) => `        ${k}="${v}"`);
  return [
    `<script src="${manifest.origin}/${manifest.file}"`,
    `        integrity="${manifest.integrity}"`,
    `        crossorigin="anonymous" defer`,
    ...lines,
  ]
    .join("\n")
    .concat("></script>");
}
