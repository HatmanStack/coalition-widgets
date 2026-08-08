/* The site: two pages and the state they share.
 *
 * Hash routing rather than a router library. It is two pages, the links are shareable, and
 * static hosting needs no rewrite rule to serve them — a history-API route would 404 on a hard
 * refresh unless Amplify were configured to rewrite every path to index.html, which is a
 * deployment detail this does not need to own.
 */

import { useEffect, useState } from "react";
import { useManifest, LLM_TXT, WIDGET_ORIGIN } from "./manifest.js";
import Help from "./Help.jsx";
import Builder from "./Builder.jsx";

const PAGES = [
  ["", "How it works"],
  ["builder", "Build your tag"],
];

function useRoute() {
  const read = () => window.location.hash.replace(/^#\/?/, "");
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export default function App() {
  const route = useRoute();
  const state = useManifest();
  const onBuilder = route === "builder";

  return (
    <>
      {/* The plate states the palette everything below it is drawn in: this blue is the widgets'
          own first series. The wordmark carries the same house mark as the tab icon, so the page
          and the browser agree about what this is. */}
      <header className={onBuilder ? "masthead compact" : "masthead"}>
        <div className={onBuilder ? "wrap wide" : "wrap"}>
          <div className="wordmark">
            <img src="/favicon.svg" alt="" width="26" height="26" />
            <span>Sedgwick County</span>
          </div>
          <h1>Coalition data widgets</h1>
          {/* The two pages have different jobs. How-it-works is a document and opens with a
              statement; the builder is an instrument and should open with the instrument, so it
              gets the plate at a third the height. The sample-data caveat survives either way —
              it is the one thing on this plate that is not decoration. */}
          <p className="lede">
            {onBuilder
              ? "Every figure shown here is sample data."
              : "Current figures on homelessness, on your website. One line of HTML, no account, nothing to maintain. Every figure shown here is sample data."}
          </p>
        </div>
      </header>

      <nav className="tabs">
        <div className={onBuilder ? "wrap wide" : "wrap"}>
          {PAGES.map(([slug, label]) => (
            <a
              key={slug}
              href={`#/${slug}`}
              aria-current={route === slug ? "page" : undefined}
            >
              {label}
            </a>
          ))}
          <a className="out" href={LLM_TXT}>
            Reference for assistants
          </a>
        </div>
      </nav>

      <main>
      <div className={onBuilder ? "wrap wide" : "wrap"}>
        {state.status === "loading" && <p>Loading the widget catalogue…</p>}

        {/* Both failures name the origin. Everything on these pages is read from it, so "which
            build am I looking at" is the first question either one raises. */}
        {state.status === "error" && (
          <div className="banner bad">
            <b>Could not reach the widgets.</b> Nothing on this page can be
            built without them. Tried{" "}
            <code>{WIDGET_ORIGIN}/v1/manifest.json</code> and got:{" "}
            {state.detail}
          </div>
        )}
        {state.status === "stale" && (
          <div className="banner bad">
            <b>The widgets at this origin are an older build.</b> {state.detail}{" "}
            Read from <code>{WIDGET_ORIGIN}</code>.
          </div>
        )}

        {state.status === "ready" &&
          (onBuilder ? (
            <Builder manifest={state.manifest} />
          ) : (
            <Help manifest={state.manifest} />
          ))}

        <footer>
          Source: Coalition HMIS via Looker. Unaffiliated concept work — not
          produced, authorised or endorsed by United Way of the Plains or the
          Coalition to End Homelessness.
        </footer>
      </div>
      </main>
    </>
  );
}
