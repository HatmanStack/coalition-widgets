# Widget platform: proposed shape

Written against `docs/HANDOFF.md`. Sections 1 to 4 are being built in `widgets/` through
`docs/plans/2026-08-01-publisher/`; the gate is complete and approved. Sections 5 onward, the
embed bundle and its documentation, are still design.

Where this document and the implementation disagree, see 3.4, which records the two places the
implementation supersedes **this file** deliberately. Anywhere else, a disagreement between this
file and the code is a defect in one of them rather than a decision.

Separately, this document supersedes `docs/HANDOFF.md` in three places: no CodeBuild (5.12), a
script tag rather than `[data-chc]` containers (5.1), and a gate that refuses rather than folds
(`Phase-0.md` ADR 1). `HANDOFF.md` carries that table at the top so nobody builds from it alone.

## 1. Repo layout

```
coalition-homelessness/
├── README.md              map of the repo
├── amplify.yml            monorepo build spec, appRoot: site      [done]
├── docs/
│   ├── FINDINGS.md        audit of the live dashboard             [done]
│   ├── HANDOFF.md         the brief                               [done]
│   └── PLAN.md            this file
├── site/                  the one-off page, Amplify               [done]
├── powerbi/               reference only, abandoned option        [done]
└── widgets/                                                       [building]
    ├── template.yaml      SAM: bucket, CloudFront, Lambda, schedule, alarms
    ├── samconfig.toml
    ├── publisher/         Python, stdlib only, zero dependencies
    │   ├── gate/          the gate. Pure. Knows nothing about Looker or S3.
    │   │   ├── checks.py  one function per check
    │   │   └── contract.py  the field allowlist and the measure registry
    │   ├── sources/       adapters in. looker.py, file.py
    │   ├── sinks/         adapters out. s3.py, stdout.py
    │   └── app.py         handler: source, gate, hash, sink, archive
    ├── embed/
    │   ├── src/
    │   │   ├── boot.js    currentScript, parse attributes, mount, dedupe
    │   │   ├── store.js   one fetch per cadence file, one timer, subscribe
    │   │   ├── env.js     container observer, theme resolution, motion, fonts
    │   │   ├── degrade.js the width ladder
    │   │   ├── layout.js  pure: (spans, width) → columns. Fuzzed, no DOM.
    │   │   ├── errors.js  every message and its CHC code, one place
    │   │   ├── sheet.js   the palette as a constructable stylesheet
    │   │   ├── chart.js   bar, stack, column, meter primitives
    │   │   └── widgets/   one file per widget name
    │   └── build.mjs      esbuild to IIFE, hash, SRI, widgets.json, llms-full.txt
    ├── docs/              one source, rendered to /v1/docs and /v1/llms-full.txt
    ├── fixtures/          five valid payloads, and twenty-one built to defeat the gate
    ├── tests/
    │   ├── gate/          one test per hostile fixture
    │   └── render/        Playwright against hostile host pages
    └── README.md
```

Two stacks, deliberately. `site/` stays on Amplify. `widgets/` is its own SAM stack. The page
cannot break when the pipeline does.

## 2. Infrastructure

`us-east-1`. No custom domain: the embed is only ever loaded by a script tag, so the
`d*.cloudfront.net` name is the product. No ACM certificate, no Route 53, no alternate domain
names, and the default CloudFront certificate covers it.

One consequence to take seriously. **That hostname is permanent the moment a partner pastes
it**, and it is also what they add to their CSP. A distribution that gets deleted and recreated
comes back on a different name and every embed on every partner site breaks at once, silently,
with no way to reach them. Mitigation is cheap: `DeletionPolicy: Retain` and
`UpdateReplacePolicy: Retain` on the distribution and the bucket, so a stack teardown cannot
take the URL with it. Do this in phase 2, before the first partner exists, because it is
worthless afterwards.

SAM. The Lambda is the only real compute; everything else is CloudFormation in the same
template.

| Resource | Notes |
|---|---|
| `AWS::S3::Bucket` public | Private bucket, reached only through CloudFront OAC. Versioning on: the archive's correction history lives here and is not served. |
| `AWS::CloudFront::Distribution` | One origin. Behaviours: `/v1/data/archive/*` immutable, `/v1/data/*` short, `/v1/*.js` by name. `Retain` on delete and replace. |
| `AWS::CloudFront::OriginAccessControl` | SigV4. OAI is legacy. |
| `AWS::CloudFront::CachePolicy` | MinTTL 0, DefaultTTL 60, MaxTTL 31536000. Origin `Cache-Control` wins. No headers, cookies or query strings in the cache key. |
| `AWS::CloudFront::ResponseHeadersPolicy` | CORS `Access-Control-Allow-Origin: *`, plus `X-Content-Type-Options` and `Referrer-Policy`. |
| `AWS::Serverless::Function` publisher | Python 3.13, 256MB, 30s. |
| `ScheduleV2` event on the function | Generates `AWS::Scheduler::Schedule`. `ScheduleExpression` is a template parameter. Ships `State: DISABLED`. |
| `AWS::SecretsManager::Secret` | Looker client id and secret. |
| `AWS::CloudWatch::Alarm` | On a `PublishFailed` metric. One failure alarms. |

No CodeBuild. The bundle is built locally and uploaded, per 5.12.

Cadence is two values and nothing else: the `ScheduleExpression` parameter, and the
`Cache-Control` the Lambda writes as object metadata. No other code reads the cadence.

### Verified while researching

- CORS belongs on the CloudFront response headers policy, not the S3 bucket. Do **not** forward
  `Origin`. Forwarding it without adding it to the cache key is the documented cause of
  intermittent CORS failures, and with `ACAO: *` there is nothing to vary on.
- `Cache-Control` written as S3 object metadata is honoured by CloudFront given MinTTL 0.
- `ScheduleV2` in SAM generates `AWS::Scheduler::Schedule`. EventBridge scheduled rules are the
  legacy path and AWS now recommends Scheduler.
- Cost holds. CloudFront's always-free tier is 1TB and 10M requests a month and origin fetches
  from S3 are free. Invalidations are free to 1,000 paths a month, then $0.005 each, so the
  handoff's ~$211/month figure for per-minute invalidation is right and never-invalidate stands.

## 3. Getting the data out of Looker

Two separate questions. What the widget reads, and how that object gets written.

### 3.1 Read path: static JSON on S3, not a query API

DynamoDB behind a Function URL or API Gateway buys query flexibility: segments and year ranges
sliced server-side instead of shipped whole. It costs a cold start on the critical path of a
partner's page render, per-request compute, and CORS, throttling and caching you have to build
rather than inherit.

The deciding number is payload size. Ten widgets, four segments, six years of history: this is
kilobytes. Call it 15KB of JSON, 4KB gzipped, smaller than one photo on the page it sits in.
There is nothing to slice. Fetch it once per page, render every widget from memory.

**Static JSON on S3 behind CloudFront.** No compute on the read path at all, cached at the edge,
inside the free tier, and it cannot fall over under load. DynamoDB earns its place only if the
payload grows past what is reasonable to ship whole, or if an authenticated by-name-list product
ever appears. Neither is now, and this should not be relitigated without one of those changing.

### 3.2 One file per cadence, not one file

```
/v1/data/live.json        Cache-Control: max-age=60       one measure only, see 4.5
/v1/data/weekly.json      Cache-Control: max-age=3600
/v1/data/monthly.json     Cache-Control: max-age=3600
/v1/data/quarterly.json   Cache-Control: max-age=3600
/v1/data/annual.json      Cache-Control: max-age=3600
/v1/data/index.json       Cache-Control: max-age=300      what exists
/v1/data/archive/…        Cache-Control: immutable        every period, see 4.4
```

Two cache values, not five. Everything that is not the live file gets an hour, because a widget
showing a weekly figure within an hour of it changing is not meaningfully worse than showing it
within ten minutes, and one number is easier to reason about than a ladder of them. The cadence
still matters in the payload, where `data-refresh="auto"` reads it. It just does not need a
bespoke `Cache-Control` per file to express itself.

Every widget declares which file it needs. The store fetches only the files the widgets present
on the page actually use, and polls each at its own interval. A page carrying only `pit-trend`
and `alice-gap` never opens a connection to the fast file.

This makes `data-refresh="auto"` fall out of the file layout instead of needing per-measure
logic in the client, and it makes constraint 4 structural: **`live.json` holds exactly one
measure**, enforced by the gate, and there is nowhere else for a second fast measure to go.

### 3.3 Write path: the gate is the fixed point, the transport is an adapter

The gate is the job. Everything else is plumbing, so the plumbing should be swappable and the
gate should not move.

```
sources/looker.py  ─┐
sources/file.py    ─┼─→  gate(payload) → Result  ─┬─→  sinks/s3.py
                    │                              └─→  sinks/stdout.py
```

`gate()` is pure: payload in, `Result` out, no I/O, no clock, no network. That is what makes the
adversarial tests cheap to write and impossible to fake.

Consequence worth taking seriously: **`sources/file.py` means the whole platform can be built
and shipped before Looker access exists.** The handoff's open questions 2 and 3 (can Looker
pre-aggregate, what is the Look ID and its fields) block phase 6 and nothing else. The figures
in the handoff are real, transcribed, and enough to publish from on day one. A quarterly
hand-published payload that passes the same gate is a legitimate product, not a stopgap.

Alternatives considered and rejected:

| Option | Why not |
|---|---|
| Looker S3 action pushing to the public bucket | Wants a long-lived Access Key ID and Secret, no role option. Trades a short-lived Looker token held by a Lambda for permanent AWS keys held by Looker. Also delivers raw Look output with no gate. |
| Looker push to a private landing bucket, S3 event to the gate | Keeps the gate, still needs permanent IAM keys in Looker. Available later if Looker load ever becomes the problem. |
| Step Functions | The gate wants to be one atomic function over one payload. Distributing it buys per-step retry we do not need and costs the property that makes it testable. |
| Fargate scheduled task | Nothing here comes close to 15 minutes. |
| Scheduled CI job committing the JSON | Gives a free diff history, but puts credentials in CI and reintroduces the dependency-install-to-production path the handoff already argued out. Defensible quarterly, not at speed. |

### 3.4 Two places the implementation supersedes this document

Recorded here so this file does not quietly disagree with the code. Both are narrow, both are
improvements, and both are argued in full at `docs/plans/2026-08-01-publisher/Phase-0.md`, ADR 15
and ADR 16. Everything not listed below still follows this document.

**A series point is `{label, value, components}`, not `{label, total, ...siblings}`.** This
document wrote a PIT point as a `total` with component keys as siblings at the same level. Four
reasons it changed, and none is tidiness: every count then sits under one key name, so a count
position is one rule rather than four; the small-cell property test becomes mechanically writable,
because telling `sheltered` from `label` no longer needs a registry lookup per key; components
stop having to be globally allowlisted at point level, so the registry can own which component
names a series may use; and `total` was already taken, meaning the sum across points at series
level, which is exactly the collision that produces a correct-looking bug in reconciliation.

**The suppression block is `suppressed: {count, value}`.** This document and `docs/HANDOFF.md`
both name it as two flat keys in prose. `docs/HANDOFF.md`'s own contract example twelve lines
below its prose already writes the nested form, so the brief contradicts itself here and something
had to be chosen. The nested form wins because the example is the more precise statement, because
the series case needs the identical shape under a different name (`withheld: {count, value}`) and
nesting makes that one validated shape used twice rather than two more allowlist entries and a
second pair of rules, and because `residual` is already nested. **The semantics are unchanged.**
Suppression still emits its residual so totals sum to the universe, and `HAVING count >= 5`
remains the bug it prevents. Only the spelling moved.

## 4. The gate

Nine checks, each a pure function, each with a fixture built to defeat it. Ordered so the
cheapest and most structural fail first.

| # | Check | Fails when |
|---|---|---|
| 1 | Response shape | Looker returned an error object with HTTP 200 |
| 2 | Field allowlist | Any field name is not in `contract.py`. Unknown field is a fail, not a warning. |
| 3 | Cardinality | Row count over the ceiling. An aggregate Look returning thousands of rows means the Look was changed. |
| 4 | Type and domain | A value is not a non-negative integer, or `apply_formatting` leaked `"1,263"` strings |
| 5 | PII scan | Anything ID-shaped, email-shaped, date-of-birth-shaped, or a free-text column |
| 6 | Suppression | Applies `MIN_CELL = 5`, emits `suppressed: { count, value }`. See 3.4. |
| 7 | Reconciliation | Named categories plus residual plus suppressed does not equal the universe exactly |
| 8 | Single fast measure | `live.json` would carry more than one measure |
| 9 | Population floor | A fast measure whose universe is under 100 |

Any failure: no PUT, previous payload keeps serving, `PublishFailed` metric, alarm. Never a
partial payload. Then hash against the current object; equal means skip the PUT.

### 4.4 The archive is public, and it is part of the product

Decided: public. The reasoning holds. Each payload was public when it was published, and a
record of it stays public.

I argued earlier that a public archive defeats constraint 4 by letting an observer
cross-difference successive snapshots. That was pointed at the wrong control. Anyone who runs a
poller gets the same capability from the live file whether or not an archive exists, so a
private archive only raises the cost for an adversary too lazy to write a cron job. The controls
that actually bear on differencing are upstream: the population floor, `precision`, and the fact
that `live.json` can hold exactly one measure. If a fast measure is ever defined, that is when
the question is real, and it will be a question about the fast measure rather than about the
archive. None exists today, so nothing is deferred that matters.

The consequence worth building for: **an archive people are meant to use is an API, not a
folder.** That means it is not enough to drop timestamped blobs somewhere reachable.

```
/v1/data/index.json                      max-age=300
/v1/data/archive/quarterly/2026-Q1.json  max-age=31536000, immutable
/v1/data/archive/annual/2026.json        max-age=31536000, immutable
```

- **Periods, not timestamps.** `2026-Q1.json` is guessable and means something. A reader can
  construct the URL without reading documentation. `<period>-<ts>.json` cannot be found without
  first being told it exists.
- **`index.json` is the entry point.** It lists every period available per cadence, with its
  as-of date and its `schemaVersion`. Without it the archive is undiscoverable and every
  consumer hardcodes filenames.
- **Corrections overwrite the period file.** S3 versioning keeps what was replaced. The public
  archive is the best current record of each period; the version history is the audit trail, and
  that part stays private. This is the split the handoff's "what was public on date X" question
  was actually reaching for.
- **Same gate, no exceptions.** An archive object is written by the same publisher through the
  same nine checks. There is no path that writes an archive file without passing them.
- **CSV alongside JSON.** The people most likely to use this for the story are working in a
  spreadsheet, not a fetch call. It is a few lines in the publisher and it roughly doubles who
  can use the thing.

Attribution and the disclaimer travel with the data, in `meta`, so a payload that gets
downloaded and passed around still says what it is and who did not authorise it.

One structural simplification falls out: the second bucket existed only to keep the archive
private. Delete it. One bucket, one distribution, an `archive/` prefix.

## 4.5 The Community Queue: publish the size, not the shape

The fast measure is now real. `docs/reference/community-queue-overview.png` is the CQ Overview,
and it is the operational housing prioritisation list, changing minute by minute. Its headline is
publishable at that cadence. **Almost nothing else on it is**, and the reasons are the exact ones
`docs/HANDOFF.md` constraints 4 and 5 were written for, so this is applying the rules rather than
inventing them.

### What is on that dashboard

| Tile | Value | Verdict |
|---|---|---|
| Clients currently on CQ | 1,308 | **Live, per minute.** Well above the ~100 floor. |
| Chronically homeless on CQ | 532 | Weekly |
| Older adults 55 to 61 | 181 | Weekly |
| Seniors 62+ | 137 | Weekly |
| Total older adults and seniors | 318 | Weekly. A printed tile, not a derived sum. |
| Unaccompanied youth clients | 71 | Weekly |
| Veterans currently on CQ | 28 | Weekly. Never at speed. |
| Average days on CQ | 173 | Weekly. Derived over a changing population. |
| Monthly referrals to CQ | 20 points, three below 5 | Monthly. Suppression applies, see below. |
| Parenting youth households | 6 | **Do not publish.** See "the flicker problem". |
| On a CQ multiple times | 1 | **Never, at any cadence.** Excluded from the contract. |
| Households | 1,308 | **Do not publish** until it reconciles. See below. |

### Why the segments cannot be fast, and why weekly fixes it

Constraint 4 is not abstract here. Publish the total and the veteran count together at minute
cadence and the arithmetic is immediate: the total drops by one and veterans drops by one in the
same window, so **a veteran left the queue at 14:04.** There are 28 of them. Add the chronic count
moving in the same minute and it narrows again. Local providers know their veteran caseload, so
in a county this size that resolves toward a specific person.

**Weekly dissolves that**, and it is worth being explicit about why rather than treating it as
"slower is safer". The attack needs a co-occurring change in a narrow window. The queue takes
roughly 200 referrals a month, so a week contains something like fifty arrivals and departures.
A weekly veteran decrement is one event among fifty, and the observer cannot tell which of the
week's departures it was. The dilution comes from the window, not from the delay, and a week is
wide enough to supply it.

**No rounding.** Exact figures throughout. With a single fast measure the differencing channel is
already closed, and rounding would only be defence in depth against an attack that needs a second
signal there is no longer any way to obtain. `precision` stays in the contract, permanently set to
`exact`, because it is the guard that stops a future rounding switch from presenting a rounded
figure as an exact one. That failure is called out explicitly in `docs/HANDOFF.md` and the cost of
preventing it is one field.

### The flicker problem, which is why parenting youth households cannot publish

Six is six at every cadence. `MIN_CELL` is five, so that measure sits **one bad week** above the
suppression threshold, and publishing it weekly means fifty-two observations a year of a number
that will cross it.

When it does, the series reads `6, 6, 5, [withheld], 5`. Anyone watching learns that the withheld
week was four or fewer. **The act of suppressing is itself the disclosure.** Suppression that
flickers is not suppression, it is a flag on the weeks that matter most.

The general rule this implies, which the gate should carry: **a measure that can cross `MIN_CELL`
under normal variation should not be published on a recurring basis at all.** Suppressing it in
the weeks it dips is worse than never having published it, because the pattern of absence is
legible. Parenting youth households is that measure. Unaccompanied youth clients at 71 is not, and
covers the youth story adequately on its own.

"Clients currently on a CQ multiple times: 1" is the sharpest cell on the page. It is a count of
one specific person, and any movement in it is an event about that person. It is also an
operational data-quality metric whose entire purpose is telling staff to go merge a duplicate
record. It has no public meaning. **It should not exist in the contract at all**, alongside the
five measures `docs/FINDINGS.md` already excludes, so that no future widget can reach it.

### What this means concretely

```
live.json     queueTotal only. One measure. No segments. Ever.
weekly.json   veterans, chronic, unaccompanied youth, older adults, seniors,
              average days on queue
monthly.json  referrals to CQ, as a series
```

**The live measure has no segments, and that is a contract fact rather than a convention.** If
`data-segment="veterans"` resolved against a live measure, a script attribute on a partner's page
would defeat the entire control. The registry records available segments per measure, the live
measure declares none, and the gate rejects a payload that gives it any. This is what §5.9's
segment handling and the brainstorm's decision 12 are load-bearing for.

### Two things to resolve before this publishes

1. **1,308 clients and 1,308 households cannot both be right.** The same dashboard reports 6
   parenting youth households, and a parenting youth household is not one person. So either the
   household tile is duplicating the client count, or children on the queue are not counted as
   clients, or one tile is mislabelled. This is the same class of defect as the 1,478-households
   figure in `docs/FINDINGS.md`, and it gets the same treatment: do not publish either until they
   reconcile.
2. **Suppression on a time series is not suppression on categories.** The referrals chart has
   three months below `MIN_CELL`: roughly 2, 2 and 3 in early 2025. The existing rule folds
   sub-threshold categories into an unnamed residual, which cannot work on a time axis because
   February and March are not foldable into "other months". The honest handling is a **withheld
   point**, labelled, with the residual carried in the series metadata so the total still
   reconciles. That is a variant of check 6 the gate needs explicitly, not an edge case for it to
   improvise.

   Worth noting the counter-argument, because it is reasonable: a monthly referral count is an
   event count with no characteristic attached, so "2 people were referred in March 2025" names
   nobody. `MIN_CELL` exists for category cells where the category is itself a descriptor. Applying
   it here is conservative and costs three points out of twenty, and the conservative call is the
   right default until someone with the underlying data says otherwise.

### The framing that settles most of it

The Community Queue is the operational by-name prioritisation list. `docs/HANDOFF.md` question 5
anticipated exactly this and gave the answer: the operational list is a separate authenticated
product, not a widget on a public CDN. What is safe to publish from it is **how many people are
waiting, not who is waiting or what kind of person they are.**

Publish the size of the queue. Not its shape.

## 5. The embed contract

### 5.1 The script tag is the entire surface

One tag. No divs, no second step, nothing to wire up.

```html
<script src="https://d2xxxxxxxxxxxx.cloudfront.net/v1/chc.a1b2c3d4.js"
        integrity="sha384-..." crossorigin="anonymous" defer
        data-widgets="hmis-snapshot"></script>
```

**It renders where it sits.** `document.currentScript`, read synchronously at the top of the
bundle, gives the tag, and the widget container goes in immediately after it. This works with
`defer`. It does **not** work with `type="module"`, where `currentScript` is null, which is a
concrete reason the bundle is a classic IIFE rather than a module beyond the no-build-step one.

**Order is list order.** `data-widgets="active-count,pit-trend,race-ethnicity"` renders those
three, in that sequence. Placement is where the tag is.

**Several tags on one page are fine and cost one fetch.** The file is fetched once and served
from cache, executes once per tag, and every execution after the first sees the existing global
and registers a mount instead of re-initialising. One store, one timer per cadence file,
regardless of how many tags there are.

**Parameters on a tag apply to every widget in that tag.** Different settings for different
widgets means a second tag, which is easier to explain and to get right than any per-widget
syntax inside an attribute value.

One escape hatch, `data-target="#some-id"`, which renders into that element instead of in place.
It exists because some CMSes and security plugins relocate or strip inline script tags, and when
the tag moves the widget moves with it. It is the answer to "it appeared in my footer", and it
should be documented under that symptom rather than as a feature.

Unknown widget names render as a labelled slot naming what does not exist. Nothing is ever
silently dropped, because a silently dropped widget is a page shipped with a chart missing that
nobody finds out about.

### 5.2 The catalogue, and what each widget needs from a container

Three numbers per widget, in px of container inline size. Below `min` it degrades to a figure.
Between `min` and `ideal` it is doing its job. Above `max` it stops stretching.

| `data-widgets` name | Reads | min | ideal band | max | Span in a stack |
|---|---|---|---|---|---|
| `hmis-snapshot` | quarterly | 300 | 480 to 1200 | 1280 | full |
| `active-count` | quarterly | 180 | 320 to 560 | 640 | full |
| `newly-homeless` | annual | 280 | 380 to 760 | 900 | wide |
| `pit-trend` | annual | 260 | 360 to 720 | 860 | wide |
| `inflow-outflow` | annual | 260 | 340 to 640 | 760 | wide |
| `alice-gap` | annual | 240 | 320 to 600 | 720 | wide |
| `race-ethnicity` | quarterly | 240 | 300 to 560 | 680 | single |
| `shelter-status` | quarterly | 220 | 280 to 560 | 680 | single |
| `length-of-stay` | annual | 200 | 280 to 520 | 620 | single |
| `retention` | annual | 180 | 240 to 480 | 560 | single |

Those numbers are a starting point. They get settled by rendering each widget at width and
looking at it, not by reasoning about them here.

`length-of-stay` renders the 2025 outcomes figure, 51 average days locally against a national
176 in 2024. It is **not** the Power BI length-of-stay distribution, which `docs/FINDINGS.md`
excludes for resolving to a ~2,905 population. Do not wire the excluded measure into this name.

### 5.3 Sizing

Size and variant are different questions and should not be one parameter. **Size is how big the
content renders. Variant is how much content there is.** A partner fitting a 280px sidebar wants
small type at full content; a partner filling a hero band wants large type at figure-only. Those
are independent axes and collapsing them produces a parameter nobody can predict.

`site/index.html` already carries the whole type scale as six clamp bands, `--step--1` through
`--hero`. In the bundle those become one `--scale` multiplier on the shadow root, with every
size expressed against it. `data-size` sets the multiplier; everything else falls out.

| `data-size` | `--scale` | Reads like |
|---|---|---|
| `xs` | 0.80 | A figure in a byline |
| `sm` | 0.90 | Sidebar card |
| `md` | 1.00 | The deployed page today |
| `lg` | 1.15 | Feature block |
| `xl` | 1.30 | Full-width hero band |
| `auto` | derived | Default |

`auto` derives the step from the container's own inline size, not the viewport:

```
< 300px   xs        420 to 700   md        > 1000   xl
300–420   sm        700 to 1000  lg
```

Those boundaries are a starting point and get tuned by rendering, not by reasoning.

Three things do **not** scale with `--scale`, because they are design rules rather than
typography:

- Bar and stack thickness stays capped at 24px however large the type gets. The cap is a rule
  from the design system. The floor scales down, the ceiling does not move.
- The 2px gap between stacked segments is a constant, and segment widths keep subtracting it so
  the bar still sums to exactly 100% of its track.
- Stroke and border weights stay at 1px. Scaling hairlines produces mush.

Chart plot height derives from the size step and the widget's natural aspect, with no parameter.
The deployed page hardcodes `height: 200px` on `.cols`; in the bundle that is the derived value
at `md` and it scales from there. See 5.4 for why there is no `data-height`.

`data-variant` stays as it was, and its `auto` default also comes from container width: below
about 300px there is no room for a table view and a note, so `compact` is the honest default
rather than a squeezed `full`.

### 5.4 Not enough space, and too much

The asymmetry that resolves most of this: **width is scarce, height is not.** A web page scrolls.
So "not enough space" almost always means "not enough width", and the answer is to reflow and
thin out, never to drop content. The genuinely hard case is a host that constrains height, which
is rare in page flow and common in a dashboard tile, and it gets its own treatment below.

**As width falls, thin out in this order.** Each rung removes the least valuable thing left.

1. Table view moves from beside the chart into a `<details>` disclosure.
2. Legend goes from inline to stacked, direct labels drop to a legend.
3. `compact`: the note and source line collapse into a disclosure.
4. `figure-only`: headline number, its label, its period. Nothing else.
5. Below `min`: `figure-only`, plus a line saying the chart needs more width.

Never on this ladder: dropping a requested widget, clipping content, or scrolling the page
sideways. A wide table may scroll inside its own `overflow-x` container. The page never does.

**As width grows, use the room rather than pad it.** In order:

1. Stop stretching at `max`. A 1400px-wide hero number is not better than a 640px one, it is
   just harder to read. Past `max` the widget caps and centres in its space.
2. Above the ideal band, promote instead of inflate. Table comes out of the disclosure and sits
   beside the chart. `hmis-snapshot` goes two-column. Direct labels come back.
3. In a stack, spare width becomes more columns rather than wider widgets. That is the whole job
   of the column algorithm, and it is why widgets declare a span.

**Height-constrained hosts: deferred, not solved.** If a host sets a fixed height with
`overflow: hidden`, we overflow invisibly and the reader loses content with no signal. It is the
worst failure mode available, because it is silent.

It is also a dashboard-tile problem, not a page-flow problem, and partners are embedding in page
flow on sites they control. So the measured fit pass, `fit.js`, and `data-height` are **cut until
a real fixed-height case appears.** They exist only for that case, and building them now is
carrying a loop, a debounce, an oscillation guard and a parameter for a situation nobody has.

If it does appear, the design is written down and small: after first paint compare `scrollHeight`
against the height available, step down one rung of the ladder above, at most twice, monotonically,
debounced to once per resize settle. And if it still does not fit at `figure-only`, **let it
overflow rather than clip**, because a visible overflow is a bug someone can see and a clipped one
is a bug nobody sees.

The degrade ladder itself stays. It is driven by width, which every host has.

### 5.5 Combinations, and why they are not a combinatorial problem

Ten widgets in any order at any width is a space nobody can test. The way out is not more test
cases, it is making combinations unable to interact.

Every widget is a pure function of `(payload, its own parameters, its own container width)`. It
reads nothing from its siblings and writes nothing they can see. Stack layout is a pure function
of `(list of spans, container width)`. Given both:

- Each widget is tested once per breakpoint. Ten widgets, four widths, forty renders.
- The layout function is fuzzed over random lists and widths. It has no DOM and no I/O, so this
  is nearly free.
- The combination space collapses from exponential to linear.

That is the real reason to keep widgets independent. Not tidiness, tractability.

Duplicates are allowed. `active-count,active-count` renders twice, because pure functions give no
reason to forbid it.

**The one combination hazard that is real is denominators**, and it is exactly the failure
`docs/FINDINGS.md` documents in the live dashboard. `active-count` says 1,263 as of 31 March.
`pit-trend` says 859 as of 29 January. Stacked with nothing between them, a reader concludes one
is wrong. The page solves this with prose it can write because it controls the whole page. The
widgets solve it with the `.period` line on every single widget, which makes that line
load-bearing rather than decorative. A widget that renders a figure without its period is a bug,
and the test is a stack of all ten asserting ten distinct period lines in the DOM.

Total page height is not our problem. Ten widgets stacked is a long page, and that is the
implementer's call to make.

### 5.6 Years

`data-years="N"` means the most recent N years of that series' **published** span. Three rules
keep it honest.

1. **Clamp to the span. Do not invent slots before it.** PIT runs 2022 to 2026, so
   `data-years="10"` renders five slots, not ten. Years before a series began are not empty
   years, they are not years.
2. **Gaps inside the span are labelled empty slots.** 2023 was never published, so it renders as
   a labelled gap, never as a short bar and never as a silently closed one. This is where that
   design rule earns its keep.
3. **The widget states the range it actually drew.** Ask for ten, get 2022 to 2026, and the axis
   and note both say 2022 to 2026. Never quietly return less than was asked for.

Spans differ per widget, which matters most in a stack:

| Widget | Published span |
|---|---|
| `newly-homeless` | 2020 to 2025, complete |
| `pit-trend` | 2022 to 2026, 2023 missing |
| disabling condition | 2023 to 2025 |
| `inflow-outflow` | 2025 only |

One `data-years` across a stack therefore produces different real ranges per widget, and their
axes will not line up. That is a comparison hazard in the same family as the denominator one, and
it takes the same fix: each widget states its own range, so a mismatch is visible instead of
misleading.

Below two points a trend is not a trend. `data-years="1"` on a trend widget renders the figure
and its period, not a one-column chart.

### 5.7 Reactive to the environment it lands in

This is the part that decides whether the widgets look native on a partner's site or look
pasted in. All of it is automatic; none of it is a parameter.

**Container queries, never media queries.** A widget in a 320px sidebar on a 1440px desktop is
narrow, and a media query says it is wide. `container-type: inline-size` on the shadow host,
every breakpoint written as `@container`. This is the single most consequential decision in the
bundle, and it is the one most easily got wrong by copying `site/dashboard.html`, which is
correctly built on media queries because it owns its whole viewport.

**Type scale in `cqi`, not `vw`.** Same reason. The Power BI mockup artifact already does this,
so there is prior art to copy from rather than invent.

**Fonts inherit.** `:host` sets `display: block` and `container-type`, and deliberately does not
reset inherited typography. A partner running Palanquin gets Palanquin with no configuration and
no font loading. Internal sizes are `em` and `cqi` relative to whatever arrives. System sans is
the fallback, not the default.

**Theme is measured, not declared.** `auto` must not mean `prefers-color-scheme`. A partner with
a dark WordPress theme and a system set to light would get an unreadable widget. Instead: walk
up the composed ancestors from the host, take the first computed `background-color` with alpha
above zero, compute WCAG relative luminance, pick light below 0.5 and dark above. Fall back to
`prefers-color-scheme` only when nothing opaque is found, which means the page never set one.
Re-resolve on `prefers-color-scheme` change and on a debounced `MutationObserver` watching
`class` and `data-*` on `documentElement` and `body`, because that is how nearly every dark-mode
toggle works.

Known failure: a page whose darkness comes from a background image with a transparent
`background-color` reads as light. That is not solvable by measurement, and it is why the
explicit `data-theme` override stays even though it should almost never be used.

**The plane is transparent.** Widgets do not paint a page background. Surfaces get painted only
where a card genuinely needs separation from what is behind it. That is most of why an embed
reads as part of the page rather than a rectangle dropped on it.

**Palette does not adapt.** Series colours stay the validated set. Inheriting a host accent
colour would be easy and would silently break the colourblind separation the palette was
validated for.

Also honoured without being asked: `prefers-reduced-motion`, and `forced-colors: active`, where
bars drawn as background fills disappear entirely on Windows high contrast and need borders.

### 5.8 Isolation is implicit

Shadow DOM is never mentioned in partner documentation and is not something a partner opts into.
There is no theming API, no exposed class names, and no `::part()` selectors, so there is no
seam to support later and no way for a host stylesheet to reach in by accident.

`mode: 'open'`, not `closed`. Closed blocks our own debugging and diagnostics without meaningfully
improving isolation, since host CSS cannot cross an open boundary either without a `::part` we
are not going to define.

The whole public surface is one script tag and the attributes below. Nothing else.

### 5.9 Parameters

All of them on the script tag, all optional except the first.

| Attribute | Values | Default | Axis |
|---|---|---|---|
| `data-widgets` | comma list, in render order | required | what |
| `data-years` | integer | the full published span | which data |
| `data-segment` | `all` \| `veterans` \| `families` \| `youth` | `all` | which data |
| `data-size` | `xs` \| `sm` \| `md` \| `lg` \| `xl` \| `auto` | `auto`, from container width | how big |
| `data-variant` | `full` \| `compact` \| `figure-only` \| `auto` | `auto`, from container width | how much |
| `data-table` | `true` \| `false` | `true` | how much |
| `data-theme` | `auto` \| `light` \| `dark` | `auto`, measured | appearance |
| `data-refresh` | `auto` \| `off` \| seconds | `auto`, from the cadence file | fetching |
| `data-target` | CSS selector | in place, where the tag sits | placement |
| `data-debug` | `true` \| `false` | `false` | diagnostics |

Ten attributes, nine of them optional. Cut from earlier drafts: `data-source`, because the origin
is compiled in per 5.12; `data-height`, with the fit pass, per 5.4; and `data-columns`, because
layout is derived from container width and declared spans and nobody has yet wanted to override
it. A parameter that exists for a case nobody has is a support cost with no benefit.

**Errors render on the page, never only in the console.** An unknown widget name, an unparseable
parameter, a failed fetch, a bundle retired by `minBundle`: each renders in place, in words.
Someone who does not write code will never open devtools, so anything only visible there does not
exist. Section 9 covers what those messages have to contain, because their real reader is an
agent looking at a screenshot.

`data-debug="true"` renders one block of key and value pairs: what was parsed, the container width
measured, the size and variant chosen, fetch status and as-of, the bundle version, and every
warning. Not a UI. It is there to be photographed.

### 5.10 SRI against shipping fixes

SRI only works on immutable files, and immutable files never update. Pinned means a partner who
pastes once is frozen forever and a privacy fix cannot reach them. Unpinned means a bucket
compromise reaches every partner in minutes.

**Pin, and put the kill switch in the data.** Every payload carries `meta.minBundle`. A bundle
whose build number is below it stops rendering figures and shows an unavailable state naming the
reason, which is the same fail-closed path as every other failure in this system. That makes
pinning safe, because the data path can always retire a build even though it can never patch one.

It is one integer in `meta`, one environment variable on the Lambda, and one comparison in the
bundle. It stays because it is the **only** retirement mechanism once the alias is cut: without it
a bad build lives on partner sites until each of them re-pastes, with no way to stop it. The
coordination worry it raised is not real here, because the person who controls the Lambda controls
the release cycle, so bumping the variable and shipping a bundle are the same act by the same
hand.

```
/v1/chc.<hash>.js    immutable, max-age=31536000, SRI digest published
```

One URL. Earlier drafts also published an unpinned `/v1/chc.js` alias so anyone who wanted
automatic updates could take them. **Cut.** It was a second path to document, a second cache
behaviour, and a second thing to explain to someone who does not want two options.

The trade being accepted: with pinning only, a bug in a shipped bundle can be **retired but not
patched.** Partners on a retired build see an unavailable state and have to paste a new tag.
Given a small set of partners on sites they control or advise, that is a conversation rather than
an outage, and "stop showing figures rather than show possibly-wrong ones" is the behaviour this
whole project is built around. Revisit only if the partner set stops being small and known.

### 5.11 Host CSP is a partner cost

A host with a strict CSP must add the CDN origin to `script-src` **and** `connect-src` or the
bundle loads and the fetch dies. Nothing we can do about it. First screen of the integration
docs, not a footnote.

Separately: a `<style>` inside a shadow root is still governed by the host's `style-src`.
Constructable stylesheets are CSSOM operations rather than inline style elements and are widely
assumed not to be covered, but that is not confirmed from a normative source, so it is a test
rather than an assumption. Build on `adoptedStyleSheets`, Baseline since March 2023, fall back
to a shadow `<style>`, and keep a fixture host page serving
`default-src 'none'; script-src <cdn>; connect-src <cdn>` that asserts the widget renders
styled. If it fails we find out in CI, not on a partner's WordPress install.

### 5.12 Build

esbuild to a single IIFE, no runtime dependencies. The build script hashes the output, writes
`chc.<hash>.js`, and emits the SRI digest into a manifest the docs page reads. 30KB gzipped,
asserted in CI as a hard failure.

The data origin is **baked in at build time**, not read from an attribute. That removes a
parameter nobody should be setting, and it makes the `connect-src` a partner has to allow
predictable, which matters because we have to tell them exactly what to add. Pointing at a
different origin is a build target, not a runtime option.

The build also emits, from the same source as the bundle so that none of it can drift:

| Artifact | For |
|---|---|
| `/v1/widgets.json` | the machine-readable catalogue, per 9.2 |
| `/v1/llms-full.txt` | the docs as markdown, for an agent |
| `/v1/docs` | the same content as HTML, for a person |
| the SRI digest | the tag in the docs, which is generated rather than typed |

Generated rather than written means the documented tag is always the tag that exists, and the
error codes in the docs are always the codes in `errors.js`. A docs build that references a
widget name, a parameter value or an error code the bundle does not define is a hard failure.

**Built locally, uploaded to S3.** No CodeBuild, no publish script. `build.mjs` writes everything
into `dist/` already correct, including the docs with the real hash and digest in them, and the
upload is two commands because the bundle and everything else want different `Cache-Control`:

```
aws s3 sync dist/ s3://<bucket>/v1/ --profile dev \
  --exclude '*' --include 'chc.*.js' \
  --content-type 'text/javascript' \
  --cache-control 'public,max-age=31536000,immutable'

aws s3 sync dist/ s3://<bucket>/v1/ --profile dev \
  --exclude 'chc.*.js' \
  --cache-control 'public,max-age=300'
```

Bundle first, which that order gives for free, because the docs carry its hash and would otherwise
point at a file not yet there.

There is no verify step and does not need to be one. **SRI is the verification.** The docs are
generated carrying the digest of the file the build just produced, so if what lands in S3 differs
by a byte the browser refuses to execute it on first load. That is a harder check than re-hashing
would be, and it fires on a partner's page rather than only on the machine that uploaded.

**The build has to be deterministic** or the hash moves with no source change and pinning stops
meaning anything. Pin esbuild exactly rather than with a caret, commit the lockfile, and treat
"two clean builds of one commit produce the same digest" as a test rather than a hope.

## 6. Phasing

Each phase ends somewhere you could stop. Note that only the last one needs Looker.

| Phase | Ships | Done when |
|---|---|---|
| 0 | `widgets/` skeleton, the contract, fixtures built from the real transcribed figures | Fixtures parse against a written contract |
| 1 | The gate as a pure library, plus its tests. No AWS. | Nine hostile fixtures each fail the run |
| 2 | SAM stack. Publisher running `sources/file.py`, schedule disabled. Archive, index and CSV. | Three cadence files, `index.json` and an archive period on the CDN, each with the right cache behaviour. `Retain` policies in place. |
| 3 | Store, environment layer, `layout.js`, `degrade.js`, `errors.js`, and three widgets: `active-count`, `pit-trend`, `race-ethnicity` | Renders light and dark, 390 and 1280, in a 320px sidebar, on hostile-CSS and hostile-CSP host pages. Layout function fuzzed. Every error state renders legibly with its code. |
| 4 | `build.mjs`, SRI, `widgets.json`, the `minBundle` kill switch | Pinned tag works, an outdated bundle refuses to render figures, `widgets.json` matches the bundle, and two clean builds of one commit produce the same digest |
| 5 | The remaining seven widgets. `hmis-snapshot` first, it is the demo. | Every widget clears the phase 3 bar, and `hmis-snapshot` reproduces both canvases from section 7 and stays coherent between them |
| 6 | The docs, generated. `/v1/docs` and `/v1/llms-full.txt`. | An agent given only the docs URL and a screenshot of each error state produces the corrected tag. Tested against each error, not assumed. |
| 7 | `sources/looker.py`, schedule enabled, alarms | A deliberately broken Look leaves the previous payload serving and alarms |

Phase 3 before phase 5 on purpose. Three widgets prove the store, the isolation, the container
queries, the theme resolution, the degrade ladder and the error rendering. Ten widgets before any
of that is proven is ten rewrites.

Phase 6 after phase 5 because the docs are generated from the real catalogue and the real error
table, so they cannot describe something that does not exist. Its done-when is a test, not a
review: take each error state, screenshot it, hand the screenshot and the docs URL to an agent,
and check that what comes back is a working tag. Documentation that has not been through that
loop has not been shown to work, it has only been read by the person who wrote it.

## 7. `hmis-snapshot`, and why it is the argument for the whole approach

The artifact linked in `docs/HANDOFF.md` is the Power BI rebuild document, and the thing in it
that specifies this widget is the **pair of canvases** shown side by side: "Page 1, Dashboard" at
1280 × 720 and "Page 2, Narrow" at 480 × 1400. Same content, two arrangements.

Content, identical in both:

- Title, and a meta line carrying the period and the source. `1 Jan – 31 Mar 2026`.
- Four KPI cards: 1,263 actively experiencing homelessness, 197 in family households, 135 in
  youth households, 59 family households.
- Race and ethnicity as sorted horizontal bars. White 679, Black or African American 343,
  Multi-racial 142, all other 99 in grey.
- Where people are staying as a 100% stacked bar with a legend. Sheltered 720, unsheltered 322,
  doubled up 108, other 113.
- People actively homeless by quarter, as columns. Q1 2026 at 1,263 and three labelled empty
  slots, which is the design rule for a missing period rather than a short bar.
- The counting definition as a footer.

Layout, the only thing that differs:

| Container width | KPIs | Body |
|---|---|---|
| above ~760px | four across | two columns: bars and stack left, quarters right |
| ~340 to 760px | two by two | one column |
| below ~340px | stacked | one column, `compact` |

**Power BI needed two separately maintained report pages to do this**, because publish-to-web
always renders a fixed canvas and ignores the phone layout. The artifact says so itself: the
two-canvas trick gets you readable at 390px and readable at 1280px, does not get you fluid in
between, and means maintaining two layouts of the same report forever.

One widget with `@container` breakpoints is both canvases and everything between them, from one
source, with no second layout to keep in step. That is not a nice side effect of the approach,
it is the clearest single demonstration of why the approach is worth building, and it should be
the first thing the integration docs show.

Spans `full` in a stack. It is the one composite that lets a partner delete the Power BI iframe
and paste a single div.

## 8. Open questions

The five in `docs/HANDOFF.md` still stand. Under 3.3 they now block only phase 6.

Settled: `us-east-1`, no custom domain, ship on the CloudFront hostname. Archive public, per 4.4.
Pinned only, no alias, per 5.10, with `minBundle` as a Lambda environment variable owned by
whoever owns the release cycle. `hmis-snapshot` is the two-canvas dashboard, per 7. Partners are
a small known set on sites they control or advise, which is what makes 5.10 and 9 affordable. The
fast measure is the Community Queue total and only that, per minute, exact, with every other CQ
measure weekly and no rounding anywhere, per 4.5. Nothing special about the `dev` account.

Two questions are now open that were not before, both raised by 4.5 and both needing someone with
the underlying data rather than a decision from here:

1. **CQ clients against CQ households.** 1,308 and 1,308, on a dashboard that also reports 6
   parenting youth households. Both cannot be right. Neither publishes until they reconcile.
2. **Does `MIN_CELL` apply to points in a time series of an undifferentiated total?** Three
   months of CQ referrals fall below it. The conservative call is taken by default, and 4.5
   records the argument on both sides.

Cut, and the reason each is now unnecessary rather than merely unbuilt:

| Cut | Because |
|---|---|
| The configurator page | The screenshot-to-agent loop covers it and more, for less work |
| `/v1/chc.js` alias | Second path to document and explain; pinning plus `minBundle` is enough for a small known partner set |
| `data-height` and `fit.js` | Exist only for fixed-height hosts, which page-flow embeds are not |
| `data-columns` | Layout comes from container width and declared spans; nobody has wanted to override it |
| `data-source` | Origin compiled in, which also fixes the `connect-src` we have to document |

Nothing is blocking phase 0.

## 9. Documentation, whose real reader is an agent

No configurator. The workflow instead:

> Someone pastes the tag. Something is wrong. They screenshot what they see, point an agent at
> the documentation URL, and the agent hands them a corrected tag.

That is less work than a configurator and it degrades better, because the same loop covers cases
a configurator never would. It also makes the documentation's primary reader an LLM rather than a
person, which is a real design constraint with specific consequences rather than a way of saying
"write it clearly".

### 9.1 The zero-parameter paste still has to be right

```html
<script src="…/v1/chc.a1b2c3d4.js" integrity="sha384-…" crossorigin="anonymous" defer
        data-widgets="hmis-snapshot"></script>
```

That, and nothing else, must produce the correct thing at every width, in the right theme, with
its period line, degrading sensibly in a narrow column. **If a default needs tuning before it
looks acceptable, the default is wrong and the fix belongs in the bundle, not the documentation.**
Every parameter most people have to set is a defect. This mattered with a configurator and it
matters more without one, because the loop above only starts when something looks wrong.

### 9.2 What writing for an agent actually changes

**One URL, one document.** An agent should fetch one thing and have everything, not navigate a
site. Ship the docs as a human-readable HTML page at `/v1/docs` and the identical content as
markdown at `/v1/llms-full.txt`, both generated from one source so they cannot disagree. The
`llms.txt` plus `llms-full.txt` split is the current convention and is what Anthropic, Stripe and
Cloudflare publish, but that split exists to index many documents. There is one document here, so
`llms-full.txt` is the file that matters.

**A machine-readable catalogue at `/v1/widgets.json`.** Emitted by the build from the same source
as the bundle, so it cannot drift. Every widget name, every parameter, every enumerated value,
each widget's min and ideal and max width, its cadence file and its published span. This kills
the single largest class of agent error, which is inventing a plausible name. An agent that has
read this file does not answer `homeless-count` when the name is `active-count`.

**Every error string appears verbatim in the docs, next to its cause and its fix.** An agent
handed a screenshot matches the string it can read against the document it was given and lands
directly on the remedy. Prose that paraphrases the error breaks that match.

**Error codes.** Every message carries a short code rendered beside it, `CHC-04`. A code survives
a phone photo of a monitor, a partial crop, and a compressed screenshot, where a sentence does
not. It is also the one token that matches with no ambiguity at all.

**Errors state what was received, not only what was expected.** `data-years="three" is not a whole
number` is actionable. `Invalid parameter` sends the agent guessing.

**Errors carry the docs URL.** A screenshot that names where to look is a complete unit of
information, and the person sending it does not have to know or explain anything else.

**Complete examples, not fragments.** Whole copy-paste-ready tags for the common situations.
Agents pattern-match on examples far more reliably than they synthesise from a parameter table,
and a fragment invites one to be invented around it.

### 9.3 The one failure this loop cannot cover

**Nothing rendered at all.** If a CMS stripped the tag or a CSP blocked the script, no code of
ours ran, so there is no error to screenshot and no code to read. No message can help, because
nothing is there to show one.

So the docs open on that case rather than burying it, with two checks a non-developer can perform
and the exact strings to look for: view source and search for `chc`, to see whether the tag
survived; and open the browser console, where a blocked script logs a CSP violation naming the
directive. An agent can be pointed at either result. Claiming the screenshot loop covers
everything would be exactly the kind of plausible-looking wrongness this project exists to
avoid.

### 9.4 Document order

1. The tag. Paste this.
2. What you should see.
3. Nothing appeared. The two checks from 9.3.
4. Something appeared and it says something is wrong. The full error code table.
5. Choosing widgets. The catalogue, with a picture of each.
6. Parameters. Every value enumerated.
7. Content Security Policy, the two lines, for sites that have one.

Reference-first documentation is written for someone who already knows what they want. Neither
the novice nor the agent arriving from a screenshot does.

## 10. The design system is already built

Deployed at `https://staging.d2g6aqspgjifxk.amplifyapp.com/`, which is byte-identical to
`site/index.html`. Read the CSS in that file, not this summary. Nothing below is new design work.

### 10.1 The card anatomy is the widget contract

Every section of that page is the same skeleton with a different form in the middle:

```
.card
  .period      mono, uppercase, muted. Period and as-of date.
  h3           optional title
  <form>       hero | tiles | cols | bars | stack | dumbbell | callout
  .legend      swatch plus label, only at two or more series
  details.tv   <summary>Table view</summary> then the table
  .note        prose, --ink-2. What the number means and what moves it.
  .src         mono 11px, --muted. Provenance.
```

That is not a coincidence to be reproduced by hand, it is the widget contract already written
down. The handoff's "every widget states its period and as-of date" is `.period`. Its "table
view available for every chart" is `details.tv`. Its "never invent a number, render unavailable
with a reason" has a natural home in `.note`. A widget in the bundle is this skeleton plus a
form, and any widget that cannot fill `.period` and `.src` is not ready to publish.

### 10.2 Form inventory, and which widget uses which

| Form | Classes on the page | Used by |
|---|---|---|
| Hero figure with delta | `.hero` `.hero-fig` `.hero-lab` `.delta` | `active-count`, `pit-trend` headline |
| Stat tiles | `.tiles` `.tile .val` `.tile .lab` | `hmis-snapshot`, funding block |
| Stacked columns | `.cols` `.col` `.stem.stacked` `.axis` | `pit-trend`, `newly-homeless` |
| Horizontal bars | `.bars` `.bar-row` `.bar-fill` | `race-ethnicity` |
| 100% stacked bar | `.stack` `.stack-lab` | `shelter-status` |
| Dumbbell, before against after | `.dumb` `.dtrack` `.dot.a` `.dot.b` | age shift, `retention` |
| Emphasis pair | `.callout` `.big` `.cl` | `length-of-stay`, `alice-gap` |
| Table | `.tablewrap` `table` | every widget, inside `details.tv` |

Ten widgets, seven forms. That is the point: the forms are the reusable part and the widgets are
thin.

### 10.3 Geometry already fixed by the page

Carry these exactly. They are the numbers the design work converged on.

- Stem width `min(24px, 62%)`, radius `4px 4px 0 0`, square at the baseline. Plot height 200px
  at `md`.
- Bar fill 18px, radius `0 4px 4px 0`, square at the axis, `min-width: 2px` so a tiny value is
  still visible as a mark rather than nothing.
- Stack 24px, `gap: 2px`, first and last segment rounded on the outside only. Segment heights
  written as `calc(N% - 1px)` so the gap comes out of the segments and the bar still sums to
  exactly 100%.
- Legend swatch 10px, `border-radius: 2px`.
- Tokens: the full set is in `site/index.html` lines 33 to 92, including `--ord-1/2/3` and
  `--past` for the dumbbell, which the handoff's palette table omits.

### 10.4 The one thing that must change

The page's type scale is `clamp(min, base + Nvw, max)` and its layouts are
`repeat(auto-fit, minmax(min(100%, 300px), 1fr))` with `@media` breakpoints. All of it keys off
the viewport, which is correct for a page that owns the viewport and wrong for a widget that
owns 280px of someone's sidebar.

Every `vw` becomes `cqi`. Every `@media` becomes `@container`. `auto-fit` on the viewport becomes
`auto-fit` inside a container context. This is a mechanical conversion, and it is also the single
most likely thing to be got wrong by copying the file, because copied CSS looks right at desktop
width and only fails in the narrow slot nobody tested.

The `.wrap` container, the `body` background, the theme toggle and the disclaimer block do not
come across at all. A widget paints no page background and ships no chrome.
