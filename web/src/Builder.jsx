/* Pick what you want, see it, copy the tag.
 *
 * This is the page the whole site exists for. The documentation can tell somebody that
 * `data-widgets` takes a comma-separated list, and they still have to assemble a tag by hand and
 * find out on their live page whether they got it right. Here they choose, watch it render at
 * the width they actually have, and copy something already correct.
 *
 * Every list on this page comes from the manifest the widget build publishes. Nothing about the
 * catalogue or the allowed values is restated here.
 */

import { Fragment, useMemo, useState } from "react";
import { tagFor } from "./manifest.js";
import Embed from "./Embed.jsx";

/* Real places a widget lands, with the width each one gives you. Content widths, so they already
   exclude a host page's own padding: 343 is a 375px phone less 16px either side. */
const WIDTHS = [
  ["Sidebar", 300],
  ["Phone", 343],
  ["Half column", 480],
  ["Article", 680],
  ["Section", 1120],
  ["Full width", null],
];

export default function Builder({ manifest }) {
  const [chosen, setChosen] = useState(["hmis-snapshot"]);
  const [params, setParams] = useState({});
  const [width, setWidth] = useState(680);
  const [dark, setDark] = useState(false);
  const [copied, setCopied] = useState(false);

  const attrs = useMemo(() => {
    const a = { "data-widgets": chosen.join(",") };
    for (const [name, value] of Object.entries(params))
      if (value) a[name] = value;
    return a;
  }, [chosen, params]);

  const tag = tagFor(manifest, attrs);

  // Order follows the catalogue, not the order boxes were ticked, so the tag is stable and two
  // people who picked the same widgets get the same tag.
  const toggle = (name) =>
    setChosen((prev) =>
      prev.includes(name)
        ? prev.filter((n) => n !== name)
        : manifest.widgets.filter((n) => n === name || prev.includes(n)),
    );

  const copy = () => {
    navigator.clipboard.writeText(tag);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="builder">
      <div>
        <fieldset>
          <legend>What to show</legend>
          {/* Names only. Each carried its full sentence from the catalogue, which is written for
              a reference table and turned this column into thirteen paragraphs — and the preview
              beside it already answers "what is this one" better than any sentence does. The
              descriptions are one click away on the how-it-works page for anyone who wants
              them. */}
          {manifest.widgets.map((name) => (
            <label className="check" key={name}>
              <input
                type="checkbox"
                checked={chosen.includes(name)}
                onChange={() => toggle(name)}
              />{" "}
              <code>{name}</code>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Options</legend>
          <div className="params">
            {Object.entries(manifest.params).map(([attr, spec]) => (
              <Fragment key={attr}>
                <label htmlFor={attr}>{attr.replace(/^data-/, "")}</label>
                <select
                  id={attr}
                  value={params[attr] || ""}
                  onChange={(e) =>
                    setParams((p) => ({ ...p, [attr]: e.target.value }))
                  }
                >
                  {/* One option per outcome. The default carries an empty value, so choosing it
                      writes no attribute at all — which is the same rendering as writing it out
                      and a shorter tag. There used to be a separate "leave it off" above these,
                      which meant every control offered two options that did the same thing. */}
                  {Object.entries(spec.values).map(([value, label]) => (
                    <option
                      key={value}
                      value={value === spec.default ? "" : value}
                    >
                      {label}
                    </option>
                  ))}
                </select>
              </Fragment>
            ))}
          </div>
        </fieldset>
      </div>

      <div>
        <div className="widthbar">
          {WIDTHS.map(([label, w]) => (
            <button
              type="button"
              key={label}
              aria-pressed={width === w}
              onClick={() => setWidth(w)}
            >
              {label}
              {w ? <b>{w}</b> : null}
            </button>
          ))}
          <span className="sep" />
          <button
            type="button"
            className="mode"
            aria-pressed={dark}
            onClick={() => setDark((d) => !d)}
          >
            Dark page
          </button>
        </div>

        <div className={dark ? "stage onDark" : "stage"}>
          {/* The widget measures its theme from the background behind it and its size from the
              width of its own container, so the preview has to be a real box of that width on a
              real background. Nothing here tells the widget what to do. */}
          <div style={width ? { width, margin: "0 auto" } : undefined}>
            {chosen.length ? (
              <Embed manifest={manifest} attrs={attrs} />
            ) : (
              <p style={{ margin: 0 }}>Pick at least one thing to show.</p>
            )}
          </div>
        </div>

        <div className="tag-plate">
          <div className="tag-plate-head">
            <span className="eyebrow">Your tag</span>
            <button className="copy" type="button" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre>
            <code>{tag}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
