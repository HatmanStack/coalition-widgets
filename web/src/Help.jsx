/* What this is and how to put it on a page.
 *
 * Ported from the generated index.html this site replaces, with the prose still coming from
 * embed/content.mjs so llm.txt and this page cannot disagree about what a widget shows.
 *
 * The audience is somebody who administers a small website and does not write code. The support
 * path is deliberately "photograph it and ask an assistant", because a partner cannot read a
 * stack trace and the widgets are built to put a code on the page precisely so a screenshot is
 * enough on its own.
 */

import {
  WHAT,
  CADENCE_WORDS,
  CADENCE_ORDER,
  slowestCadence,
} from "../../embed/content.mjs";
import { LLM_TXT, llmTxtUrl, tagFor } from "./manifest.js";
import Embed from "./Embed.jsx";
import { Fragment, useState } from "react";

const SAMPLES = ["hmis-snapshot", "active-count,queue-total,retention"];

/* Freshest first, because that is the order somebody scanning for "what can I put on the page"
   cares about. The order and the ranking come from content.mjs now: they stopped being a display
   preference the moment a widget could be on two clocks, since which group a card belongs in
   depends on which of its clocks is the slow one.
 *
 * A card is filed under the SLOWEST file it reads, not the fastest. `queue` reads live and
 * weekly, and grouping it by `cadence` alone put it under "Updates continuously" beside
 * `queue-total` — but only its headline count is continuous, and `queue-total` is the only
 * continuous number published. It files under weekly, with no line anywhere qualifying that;
 * content.mjs has why not, and it is a privacy reason rather than a layout one.
 */
function groupByCadence(manifest) {
  const groups = new Map();
  for (const name of manifest.widgets) {
    const entry = entryFor(manifest, name);
    const cadence = slowestCadence(entry);
    if (!groups.has(cadence)) groups.set(cadence, []);
    groups.get(cadence).push(name);
  }
  const rank = (c) => {
    const i = CADENCE_ORDER.indexOf(c);
    return i === -1 ? CADENCE_ORDER.length : i;
  };
  return [...groups].sort((a, b) => rank(a[0]) - rank(b[0]));
}

/* The catalogue facts for one widget, in the shape content.mjs's helpers take. `also` is absent
   from a manifest built before it was published, which reads as "one clock" — the behaviour this
   page already had, rather than a crash. */
const entryFor = (manifest, name) => ({
  cadence: manifest.cadences?.[name] || "quarterly",
  also: manifest.also?.[name] || [],
});

const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Help({ manifest, sampleData = true }) {
  const [copied, setCopied] = useState(false);
  const tag = tagFor(manifest, { "data-widgets": "hmis-snapshot" });

  return (
    <>
      {/* "Live" meant "a running widget rather than a screenshot", and it was the same word the
          page uses for a figure that is current. A reader takes the second meaning, so the
          sentence that exists to disclaim the numbers was reading as a claim about them. The
          distinction the copy has to hold is: the software is real, the numbers are not. */}
      {sampleData && (
        <div className="banner">
          <b>Every number on this page is invented.</b> The widgets themselves
          are real — the same bundle your site would load, running here — but
          they are reading a sample feed, not the Coalition&rsquo;s. The figures
          are placeholders until that feed is connected. Do not quote them.
        </div>
      )}

      <h2>What it looks like</h2>
      <p>
        These are real widgets running on this page, mounted the way your site
        would mount them. Only the figures are sample data.
      </p>

      {SAMPLES.map((widgets) => (
        <div className="sample" key={widgets}>
          <div className="cap">data-widgets=&quot;{widgets}&quot;</div>
          <Embed manifest={manifest} attrs={{ "data-widgets": widgets }} />
        </div>
      ))}

      <h2>Adding it to your site</h2>
      <p>
        Copy this and paste it into your page where you want the figures to
        appear. That is the whole installation.
      </p>

      <pre>
        <button
          className="copy"
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(tag);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <code>{tag}</code>
      </pre>

      <p>
        If your website is built with WordPress, Squarespace, Wix or similar,
        look for a block or section called <b>Custom HTML</b>, <b>Embed</b> or{" "}
        <b>Code</b>, and paste it there.
      </p>

      {/* Verified with three tags on one page: three separate panes, each beside the tag that
          asked for it, and one request for the script. Only the first of those is worth saying
          here — a partner is deciding where to paste something, not budgeting downloads. */}
      <p>
        You can paste it in as many places as you like. Each one shows the
        figures where you put it.
      </p>

      <h2>What you can show</h2>
      <p>
        <a href="#/builder">The builder</a> picks these for you and hands back a
        finished tag. To write one yourself, list the names inside{" "}
        <code>data-widgets</code> separated by commas — they appear in the order
        you list them.
      </p>

      {/* Grouped by how often each figure moves, rather than a table repeating that in a third
          column on every row. It also answers the question a partner actually has, which is not
          "what does this one show" so much as "how fresh will this be on my page". */}
      <div className="catalogue">
        {groupByCadence(manifest).map(([cadence, names]) => (
          <section key={cadence}>
            <h3>{sentence(CADENCE_WORDS[cadence] || cadence)}</h3>
            <dl>
              {/* No per-row clock. The heading is the whole statement for every widget in the
                  group, including a card reading two files — see slowestCadence in content.mjs
                  for why that card does not get a line qualifying it. */}
              {names.map((name) => (
                <Fragment key={name}>
                  <dt>
                    <code>{name}</code>
                  </dt>
                  <dd>{WHAT[name] || ""}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>

      <h2>If something does not look right</h2>
      <p>
        You do not need to work out what is wrong. An assistant can do it from a
        picture.
      </p>

      <ol>
        <li>Take a screenshot of the part of your page where the widget is.</li>
        {/* The reference deliberately shows the tag with <hash> and <digest> in place of the
            real values, so that it cannot go stale between builds — which means it tells the
            assistant to reuse the ones the partner already has. Without their tag in the
            conversation there is nothing to reuse, and an invented integrity fails closed: the
            browser refuses the script and the space stays blank, which is the one outcome with
            nothing on it to photograph. */}
        <li>
          Copy the script tag already on your page. The reference tells the
          assistant to reuse your <code>src</code> and <code>integrity</code>{" "}
          exactly — it cannot work them out, and a wrong one leaves the space
          blank.
        </li>
        <li>
          Open ChatGPT, Claude, or whichever assistant you use. Attach the
          screenshot, paste in your tag, and paste in the link{" "}
          <code>{llmTxtUrl()}</code> — or{" "}
          <a href={LLM_TXT} target="_blank" rel="noreferrer">
            open it
          </a>
          , copy everything on it, and paste that in instead.
        </li>
        <li>
          Ask:{" "}
          <i>
            &ldquo;This widget is on my website and something is wrong. Here is
            the tag I have. Using the reference, give me the corrected script
            tag.&rdquo;
          </i>
        </li>
        <li>Replace the tag on your page with the one it gives you.</li>
      </ol>

      <p>
        Widgets say what is wrong on the page itself — a short code such as{" "}
        <code>CHC-02</code>, what it received, and what it expected. That is why
        the screenshot is usually enough on its own.
      </p>

      <h2>Getting help from a person</h2>

      <div className="contact">
        <b>Questions about the figures</b>
        <p>
          What a number counts, whether it is current, or a breakdown that is
          not shown here.
          <br />
          <a href="mailto:endhomelessness@unitedwayplains.org">
            endhomelessness@unitedwayplains.org
          </a>{" "}
          &middot; (316) 267-1321
        </p>
      </div>

      <div className="contact">
        <b>The widget will not appear at all</b>
        <p>
          A blank space where the widget should be usually means your site is
          blocking the script or removing it when the page is saved. That is a
          technical fault rather than a data question — raise it with whoever
          maintains your website, or with the team that gave you this page.
        </p>
      </div>
    </>
  );
}
