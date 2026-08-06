# coalition-widgets

Looker → Lambda → S3 → CloudFront → a `<script>` tag on a partner's website.

This file is the handoff. It records what is not derivable from the code: decisions already
settled, mistakes already made, and the state of the world.

---

## What this is, and the constraint that shapes everything

Coalition partners in Sedgwick County want to put current homelessness figures on their own
websites. They paste one script tag. The figures update themselves.

The source is **HMIS data** — client-level records about people experiencing homelessness. What
we publish is a _checked derivative_, never the source. Every design decision follows from that.

**This is unaffiliated concept work.** It is not produced, authorised or endorsed by United Way
of the Plains or the Coalition to End Homelessness. The disclaimer and source line appear on
every payload and every pane, and are deliberately **not** configurable. Do not add a parameter
to switch them off, and do not remove them "for a cleaner look".

---

## Layout

```
publisher/      the Lambda. Reads Looker, checks, writes JSON to S3. Python, stdlib + boto3.
  app.py          mapping + the checks + the handler
  contract.py     THE REGISTRY. What may be published and where each figure comes from.
  looker.py       Looker API 4.0 over urllib

embed/          the bundle a partner loads
  src/            boot, widgets, chart, dom, sheet, env, store, errors, params
  build.mjs       esbuild → IIFE → hash-named → SRI → manifest → llm.txt
  content.mjs     the prose. WHAT, the cadence words, CODES, SYMPTOMS, NOT_PARAMETERS
  llm.mjs         llmText → dist/llm.txt, the copy CloudFront still serves
  buildspec.yml   CodeBuild
  test/           errors.mjs, layout.mjs, harness.html, serve.mjs

web/            THE SITE a partner is given. React + Vite, deployed by Amplify (appRoot: web).
  src/            App (hash routing), Help, Builder, Embed, manifest
  public/llm.txt  hand-written, served by the site. NOT generated — see below.
  .env            VITE_WIDGET_ORIGIN, the distribution it loads widgets from

mock-looker/    a fake Looker. scenarios.mjs is shared with the local stub.
scripts/        deploy.mjs, looker-stub.mjs, local-publish.py, check-scenarios.mjs,
                check-identifiers.py, check-llm-txt.mjs
site/           an older staging design reference, still its own Amplify app (appRoot: site).
                Unrelated to web/. Nothing in the current path reads it.
reference/      the CQ screenshot, Power BI theme
fixtures/       21 hostile fixtures inherited from the previous repo
docs/           HANDOFF, PLAN, FINDINGS, and the 2026-08-01 pipeline run incl. RCA.md
```

## Commands

```
npm run dev              stub + publish + build, then serves THE WIDGET ORIGIN on :8080 —
                         the bundle, v1/manifest.json, v1/data/*.json, llm.txt. No pages,
                         except /harness, which is ours and deploys nowhere.
cd web && npm run dev    the site. Reads the deployed distribution, not :8080, so what you
                         see locally is the tag a partner is actually handed. Point it at a
                         local bundle with VITE_WIDGET_ORIGIN in web/.env.local.
npm test                 errors + layout + identifiers + llm-txt + scenarios
npm run validate         sam validate --lint && cfn-lint
npm run deploy -- --mock --yes        deploy with a fake Looker in the stack
node scripts/looker-stub.mjs --scenario=list
```

---

## Settled decisions — do not relitigate without new information

**API, not Looker's public embed.** Looker _can_ publish a Look publicly, but the reasons not to
are the embed surface (an iframe can't read the host's background or accept
`data-widgets="a,b"`) and keeping Looker out of the request path of every page view. The privacy
gate is a _consequence_ of already having a Lambda in the middle, not the justification.

**The publisher refuses; it never repairs.** A category of 3 arriving from Looker is handed on as
3 so `check` refuses it and somebody fixes the derived table. The suppression fold belongs
upstream where it is reviewable. `check` verifies, it does not fix.

**Bands, not averages, for waiting time.** A mean published beside its denominator gives up
individual tenures to subtraction: the week-on-week change in `mean × count` is exactly the
waiting time that left the queue, and for one departure that is one person's wait, to the day.
Verified numerically. Bands are counts, so `MIN_CELL` and reconciliation already cover them.

**One live measure only.** Two fast figures let an observer watch the total drop by one and a
subgroup drop by one in the same minute. `check` enforces this; the weekly cadence exists so the
queue's subgroups move on a slower clock.

**Theme is measured, not declared.** `auto` must not mean `prefers-color-scheme` — a dark page on
a light system would get a widget that fits nothing. Backgrounds composite outward until opaque;
`0.179` is the threshold (where white and black text carry equal contrast), not `0.5`.

**Colours are not configurable.** The palette is chosen so series stay distinguishable for common
colour-vision deficiencies. A brand pair usually is not.

**`higherIsBetter` is a property of the measure, not the gap.** Income: higher is better. Days
homeless: lower is better. There is no default — a new comparison throws rather than guessing.
Both flags were once inverted and the ALICE card told readers a household earning 14,300 less
than it needs was "better than the comparison".

---

## Traps that have already cost time

**Backticks inside the CSS template literal in `sheet.js`.** They end the literal early and the
remaining CSS parses as JavaScript. Happened three times; once it _built cleanly_ and shipped a
bundle that threw `list is not defined` at runtime. `build.mjs` now fails the build on this.

**esbuild `define` substitutes identifiers, not string contents.** `__DATA_ORIGIN__` must be a
bare identifier. Written as `"__DATA_ORIGIN__"` it silently stays a string. `errors.js` wraps it
in `typeof` because `build.mjs` imports that module in Node, where the define does not exist.

**A build that passes is not a bundle that runs.** Renaming `table` → `tableOf` left two call
sites; esbuild leaves an undefined identifier as a _runtime_ error. Grep the built bundle.

**`cqi` resolves against the nearest container, not the card.** `container-type` was only on
`:host`, so a 320px card in a 1000px pane sized its figure from 1000 — 104px of type in a 265px
box. Every tile is its own container now.

**Hardcoded copies of a registry drift. Seven did in one week.** The widget list in the deploy
script, the cadence list in `local-publish.py`, `build()`'s `cadence != "live"` test, the layout
test's fixture copier, `CADENCE`/`ALSO` in `boot.js`, the scenario list. Read the registry —
`contract.CADENCES`, `CATALOGUE`, `ALLOWED`, the mock's `SCENARIOS` — never copy it.

**A parameter with no control is a parameter nobody has run.** The harness hand-listed its
widget checkboxes and its selects: eleven widgets against a catalogue of thirteen, and four
selects against six parameters. `data-titles` had no control anywhere, and it turned out that a
pane both too narrow _and_ carrying `data-titles="false"` threw `produced is not defined` and
drew nothing — losing the CHC-06 refusal that is the whole job of that branch. The condition
short-circuits while titles are on, so the dead reference was never reached. `build.mjs` now
writes `params` and `widgets` into `manifest.json` and the harness generates its controls from
them, which is what surfaced it. Every select also carries an `invalid` option, so CHC-02 is one
click away on every parameter rather than on the one that happened to be wired up.

**Guards must read the signal, not a proxy.** `ls a b` exits non-zero if _either_ is missing.
`pytest | tail -1` returns tail's status. A CodeBuild failure that printed a fallback and exited
0 meant two failed builds looked like two successful deploys.

**`git checkout <file>` on a tracked, modified file destroyed 289 lines.** Reverting a temporary
edit that way took `embed/src/widgets/index.js` back to `1170784` — not to the working state,
which was never committed. `county` and `queue` and half the file went with it. It was only
recoverable because `deploy.mjs` zips the working tree to `s3://…/build/source.zip` before every
CodeBuild run and one had gone out twenty minutes earlier; the restored file rebuilt to the exact
integrity digest the deployed manifest carried, so the recovery was provably byte-perfect. With
100 files on one commit there is no floor under any `checkout`, `stash` or `restore`. Copy the
file first, or commit.

**A claim in a comment gets repeated until it is everywhere.** "Several tags on one page cost one
fetch and one store" was wrong — an IIFE gets fresh module state per execution, so each tag reads
its own files and the cache answers the repeat. It had been copied from `boot.js` into
`store.js`, `llm.txt` and the README before anyone measured it. Measure the claim, then grep for
its other copies.

**`npm test` clobbers a running `npm run dev`.** The layout test rebuilds `dist/` with
`DATA_ORIGIN=http://localhost:8131`, so after a test run the page still open on :8080 is serving
a bundle that fetches from a port nothing is listening on. Nothing errors at the terminal. Stop
the dev server before testing, and restart it after.

**A control that silently overrides another control.** The harness had an "inject a bad value"
checkbox that set `data-size="huge"` _after_ reading the size dropdown, so with it ticked every
valid size rendered as `huge` and the page sat on CHC-02 no matter what you picked. It read as
"the error will not clear". `huge` is an option in the size list now, and there is no checkbox.

**The formatter reflows anchors.** Blind `python .replace()` on these files silently misses,
four times in one session. Read the file, then use targeted edits.

**The formatter also strips an import you have not used yet.** Adding `import re` and then
writing the code that uses it is two edits, and the hook runs between them: the import is gone
by the time the second lands, and the file only fails when something imports it. Add the import
in the same edit as its first use, or re-check it afterwards.

---

## State of the world

**AWS** — SSO profile `dev`, account `631094035453`, us-east-1.

```
stack         coalition-widgets
bucket        coalition-widgets-bucket-jlhlyyha4utx
distribution  d2s2vi2gd7olxb.cloudfront.net
publisher     coalition-widgets-PublisherFunction-9KJBMTDk0iWn
codebuild     coalition-widgets-bundle   (S3 source: build/source.zip, NOT GitHub)
mock looker   deployed only when MockLooker=true
```

**Deployed and current, as of 2026-08-05.** The bundle, `v1/manifest.json`, `v1/data/*.json` and
`llm.txt` are all live and match this working tree — the restored `widgets/index.js` rebuilds to
the exact integrity digest the deployed manifest carries. The distribution serves the widgets and
nothing else: there is no `index.html` on it any more, so its root 404s. The site is separate.

`llm.txt` had never published before today because the build role could `PutObject` on `v1/*`
only while the bucket policy had always allowed `llm.txt` to be _read_ at the root. Two policies
that had drifted apart, in one template.

**The site is not deployed yet.** `web/` builds and runs, and `amplify.yml` carries an
application for it at `appRoot: web` with a CSP naming the distribution in `script-src` and
`connect-src`. Nobody has pointed an Amplify app at it.

**Uncommitted.** Everything except `1170784`. The remote now exists
(`HatmanStack/coalition-widgets`, public) and `.github/workflows/` is staged but has never run.

**Looker is mocked.** There is no free Looker instance — no self-service trial, no public
sandbox. `mock-looker/scenarios.mjs` is the substitute, shared by the local stub and a Lambda
that deploys into the stack behind a Function URL. Every figure published is invented. The site
says so in two places, both in `web/src`: the last sentence of the lede in `App.jsx` and the
banner at the top of `Help.jsx`. Those two are the only claims to remove when real data arrives.

---

## Open work

- **A personal name arriving as a label.** `check` now scans every string in the payload for
  identifiers _with a shape_ — email, telephone, SSN, a full calendar date, a long digit run —
  which closes `05-pii-email-in-label`. It cannot catch a name: "Sedgwick" is a county and a
  surname, and a pattern that refused one would refuse the other. The derived table is still the
  only thing standing between a name and publication. Do not add a name heuristic without
  something better than a word list.
- **Comparison labels are not type-checked.** `comparisons_from` copies `hereLabel` and
  `thereLabel` straight out of the row with no string check, so a null publishes where every
  other label field would refuse. The identifier scan covers what such a label _says_, not what
  it _is_. One line in `comparisons_from`, not done.
- **The site has never been deployed.** `amplify.yml` has the application; no Amplify app points
  at it. Until it is, the tag a partner would be given exists only on a laptop.
- **Two `llm.txt` still ship.** `web/public/llm.txt` is the hand-written one the site serves and
  the only one anything links to. `build.mjs` still generates `dist/llm.txt` from `llm.mjs`, the
  buildspec still uploads it, and the bucket policy still grants read on it. Retiring it deletes
  `llm.mjs` and `CODES`/`SYMPTOMS`/`NOT_PARAMETERS` from `content.mjs`, which nothing else uses.
  Deliberate decision, not yet taken.
- **Per-widget minimum widths** — `MIN_WIDTH` is a single 240 for everything. `pit-trend` needs
  more; a stat needs less. Would make `CHC-06` name which widgets to drop.
- **`CHC-07`, a pane-level warning** — eleven widgets in a 300px column renders perfectly as a
  7,000px stack. Nothing is broken and the embed is unusable.
- **Tag-driven combination generation** in the layout test, so a fourteenth widget is covered
  without anyone remembering.
- **Mount-time CLS** — the widget inflicts ~0.19 on the host page. Skeletons removed the _late_
  shift; the mount shift can only be fixed by the partner reserving space.
- **Amplify repointing** — the `site` app still builds from `HatmanStack/coalition-homeless`.

---

## How the user works

Direct, fast, and allergic to scope creep. Wants the thing asked for, built and verified, not a
survey of options. Say what is actually true about what was tested — "I did not check that" is
always better than implying you did. When something is wrong, name it plainly and move on.

Verify in a real browser before claiming a visual thing works. Screenshots and measurements, not
reasoning about CSS.
