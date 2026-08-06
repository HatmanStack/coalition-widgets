/* One real widget, mounted the way a partner's page mounts it.
 *
 * The bundle is a classic IIFE, not a module: it reads `document.currentScript` synchronously at
 * the top and inserts its own container immediately after that script element. So there is no
 * API to call and nothing to render into — the only way to mount it is to put a <script> in the
 * document, exactly as the paste does. That is the point. A preview that rendered through some
 * React-shaped wrapper would be testing the wrapper.
 *
 * Re-inserting a classic script re-executes it, and the file is cached, so changing a parameter
 * costs a re-run rather than a re-download.
 */

import { useEffect, useRef } from "react";

export default function Embed({ manifest, attrs }) {
  const host = useRef(null);
  // Serialised, because a fresh object literal every render would remount on every render.
  const key = JSON.stringify(attrs);

  useEffect(() => {
    const node = host.current;
    if (!node || !manifest) return undefined;

    /* Inserted a tick late, and cancellable, because removing a <script> that is already
       fetching does not stop it running. StrictMode mounts every effect twice in development:
       insert synchronously and the first script is detached by the cleanup, then executes
       anyway, reads a `document.currentScript` with no parent, and falls back to appending its
       pane to document.body. Every widget rendered twice. A tick's delay lets the cleanup
       cancel before a script exists at all, and costs a production mount nothing. */
    let cancelled = false;
    const pending = setTimeout(() => {
      if (cancelled) return;
      const script = document.createElement("script");
      script.src = `${manifest.origin}/${manifest.file}`;
      script.integrity = manifest.integrity;
      script.crossOrigin = "anonymous";
      script.defer = true;
      for (const [name, value] of Object.entries(JSON.parse(key))) {
        script.setAttribute(name, value);
      }
      node.appendChild(script);
    }, 0);

    // Clears the script *and* the pane the bundle inserted beside it: both are children of this
    // node, so one call does it.
    return () => {
      cancelled = true;
      clearTimeout(pending);
      node.replaceChildren();
    };
  }, [manifest, key]);

  return <div ref={host} />;
}
