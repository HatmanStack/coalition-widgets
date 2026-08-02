/* The whole public surface: one script tag.
 *
 *   <script src=".../v1/chc.<hash>.js" integrity="sha384-..." crossorigin="anonymous" defer
 *           data-widgets="hmis-snapshot"></script>
 *
 * It renders where it sits. `document.currentScript` read synchronously at the top gives the
 * tag; the container goes in immediately after it. That works with `defer` and returns null in
 * a module, which is why this ships as a classic IIFE.
 *
 * Several tags on one page cost one fetch and one store: the file is cached, each execution
 * registers a mount, and the store is module state shared across them. */

import { CATALOGUE, NAMES } from "./widgets/index.js";
import { errorCard, el } from "./dom.js";
import { unknownWidget, fetchFailed, CODES, DOCS } from "./errors.js";
import { resolveTheme, sizeFor, watchTheme, watchWidth } from "./env.js";
import { adopt } from "./sheet.js";
import { subscribe } from "./store.js";

const script = document.currentScript;

function attrs(tag) {
  const get = (name, fallback) => (tag && tag.getAttribute(name)) || fallback;
  return {
    widgets: get("data-widgets", "").split(",").map((s) => s.trim()).filter(Boolean),
    theme: get("data-theme", "auto"),
    size: get("data-size", "auto"),
    variant: get("data-variant", "auto"),
    table: get("data-table", "true") !== "false",
    years: Number(get("data-years", 0)) || 0,
    segment: get("data-segment", "all"),
    target: get("data-target", null),
  };
}

function mountPoint(tag, target) {
  if (target) {
    const found = document.querySelector(target);
    if (found) return found;
  }
  const host = document.createElement("div");
  if (tag && tag.parentNode) tag.parentNode.insertBefore(host, tag.nextSibling);
  else document.body.appendChild(host);
  return host;
}

function render(root, name, payload, options) {
  root.replaceChildren();
  const widget = CATALOGUE[name];
  const produced = widget.render(payload, options);
  root.appendChild(produced.code ? errorCard(produced) : produced);
}

function mountOne(host, name, options) {
  const shadow = host.attachShadow({ mode: "open" });
  adopt(shadow);
  const root = document.createElement("div");
  shadow.appendChild(root);

  if (!CATALOGUE[name]) {
    root.appendChild(errorCard(unknownWidget(name, NAMES)));
    return;
  }

  const applyTheme = () => {
    const theme = options.theme === "auto" ? resolveTheme(host) : options.theme;
    host.setAttribute("data-chc-theme", theme);
  };
  applyTheme();
  watchTheme(applyTheme);

  watchWidth(host, (width) => {
    const step = options.size === "auto" ? sizeFor(width) : { scale: SCALES[options.size] || 1 };
    host.style.setProperty("--chc-scale", step.scale);
  });

  // Which file this widget reads. A measure widget takes it from the payload it is given, so a
  // page with only annual widgets never opens a connection to the live file.
  const cadence = CADENCE[name] || "quarterly";

  subscribe(cadence, (file) => {
    if (file.error && !file.data) {
      root.replaceChildren(errorCard(fetchFailed(`${cadence}.json`, file.error)));
      return;
    }
    if (!file.data) return;


    render(root, name, file.data, {
      stale: file.stale ? "Showing the last figures received. A refresh failed." : null,
      showTable: options.table,
      variant: options.variant,
      years: options.years,
      segment: options.segment,
    });
  });
}

const SCALES = { xs: 0.8, sm: 0.9, md: 1, lg: 1.15, xl: 1.3 };

const CADENCE = {
  "hmis-snapshot": "quarterly",
  "active-count": "quarterly",
  "race-ethnicity": "quarterly",
  "shelter-status": "quarterly",
  "queue-total": "live",
  "pit-trend": "annual",
  "newly-homeless": "annual",
  "inflow-outflow": "annual",
  "alice-gap": "annual",
  "length-of-stay": "annual",
  "retention": "annual",
};

function boot() {
  const options = attrs(script);
  if (!options.widgets.length) {
    const host = mountPoint(script, null);
    const shadow = host.attachShadow({ mode: "open" });
    adopt(shadow);
    shadow.appendChild(
      errorCard({
        code: CODES.BAD_PARAM,
        detail: `No data-widgets on the script tag. Available: ${NAMES.join(", ")}.`,
        docs: DOCS,
      }),
    );
    return;
  }
  if (!SCALES[options.size] && options.size !== "auto") {
    options.size = "auto";
  }

  const container = mountPoint(script, options.target);
  const list = el("div", options.widgets.length > 1 ? "stack-list cols-2" : "stack-list");
  container.appendChild(list);

  for (const name of options.widgets) {
    const host = document.createElement("div");
    list.appendChild(host);
    mountOne(host, name, options);
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
