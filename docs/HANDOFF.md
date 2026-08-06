# Session seed: embeddable HMIS widget platform

> **This is the original brief, kept as the record of what was asked for. It is not the
> current design, and three things in it were deliberately replaced.** `docs/PLAN.md` is the
> design; where the two disagree, PLAN wins. Building from this document alone would produce an
> incompatible platform, which is why the supersessions are listed here rather than only there.
>
> | This document says | Superseded by | Where |
> |---|---|---|
> | CodeBuild builds the bundle | Built locally, uploaded with two `aws s3 sync` commands. No CodeBuild anywhere. | `PLAN.md` 5.12 |
> | Mount widgets on `[data-chc]` containers | One script tag carrying `data-widgets`, rendering where it sits. No divs. | `PLAN.md` 5.1 |
> | Suppression folds sub-threshold cells in the pipeline | The gate validates and refuses; it does not repair. The fold moves to the Looker derived table. | `Phase-0.md` ADR 1 |
>
> Two smaller ones, both argued in `Phase-0.md`: a series point is `{label, value, components}`
> rather than a total with sibling keys (ADR 15), and the suppression block is nested
> (ADR 16, resolving a contradiction this document has with itself at lines 85 and 182).
>
> Everything else here still holds, including every privacy constraint and every figure.

Paste everything below into a fresh Claude Code session rooted at
`/home/christophergalliart/projects/coalition-homelessness`.

---

## What you are building

An AWS backend plus a distributable embed script that publishes the Coalition to End
Homelessness's public HMIS data as **reactive, parameterised widgets** any partner site can
drop in with one script tag.

```html
<script src="https://cdn.<domain>/v1/chc.js" defer></script>

<div data-chc="active-count"></div>
<div data-chc="pit-trend" data-years="3" data-theme="dark"></div>
<div data-chc="inflow-outflow" data-segment="veterans" data-table="true"></div>
```

Pipeline: **Looker → Lambda (scheduled, with a validation gate) → S3 → CloudFront**, with the
IIFE bundle built separately by **CodeBuild on code change only**.

Deliverables:

1. Infrastructure as code for the whole backend.
2. A Lambda that pulls from Looker, validates, and publishes JSON. The validation gate is the
   point of this job, not the fetch.
3. A CodeBuild project that builds and publishes the versioned IIFE bundle.
4. The bundle itself: widgets, parameters, reactivity, Shadow DOM isolation.
5. Tests, including tests that deliberately try to defeat the privacy gate.

---

## Context

The Coalition to End Homelessness in Wichita/Sedgwick County is led by United Way of the
Plains and runs 25 member agencies. Their public data page currently embeds a Power BI
publish-to-web report that is broken in several ways (see `docs/FINDINGS.md` in this repo, read
it first). This project replaces that embed.

**This work is an unaffiliated concept and is not authorised by the Coalition.** Every page
carries a disclaimer block saying so. Do not remove it. Do not publish anything that would
read as an official United Way artifact. `noindex, nofollow` stays until someone says
otherwise.

---

## What already exists in this repo

| File | What it is |
|---|---|
| `docs/FINDINGS.md` | Audit of the current dashboard. **Read this first.** Explains why several measures are excluded. |
| `site/index.html` | The full public page, deployed to Amplify. Self-contained, values inline in markup. Annual cadence. |
| `site/dashboard.html` | Responsive dashboard rebuild. Renders entirely from a `DATA` object. **This is the closest prior art for the widgets.** Reuse its renderers and its `suppress()` function. |
| `site/README.md` | Deploy notes, sources, known gaps. |
| `amplify.yml` | Amplify build spec plus security headers. Monorepo format, `appRoot: site`. |
| `powerbi/` | Theme JSON and report spec from an abandoned option. Power BI is out of the chain. Keep for reference, do not build on. |

`site/dashboard.html` already implements the pattern to carry forward: one data object, every
label, percentage, bar width and table row derived from it. Geometry is never typed by hand.
That rule exists because hand-typed geometry drifted from the values three separate times
during the design work.

Note: this directory is **not a git repo**. Offer to `git init` before making changes.

---

## Non-negotiable constraints

### Privacy

The source is HMIS data. Client-level records are PII. The public path must be structurally
incapable of carrying them.

1. **Aggregates only.** The Looker credential must be scoped to a model containing only
   pre-aggregated Explores. The control is on the credential, not on the query. Ideal shape is
   a derived table that aggregates and suppresses in SQL, so no client identifier exists in the
   table the public path can reach.
2. **`MIN_CELL = 5`.** Any category below five folds into an unnamed combined bucket. Enforce
   in the pipeline, not only in the renderer.
3. **Suppression must emit its residual.** `HAVING count >= 5` silently drops rows and breaks
   reconciliation, which recreates the exact bug found in the live dashboard. Always emit
   `{ suppressedCategories: n, suppressedValue: v }` so totals still sum to the universe.
4. **Only one high-cadence measure.** Publishing several fast-moving aggregates lets an
   observer cross-difference successive snapshots and characterise individuals: total drops by
   one, unsheltered drops by one, Butler County drops by one, so a specific person exited at
   14:04. Enforce single-fast-measure as pipeline config, not as a review step.
5. **Floor on live population size.** Refuse to emit a high-cadence count for any population
   under ~100. A one-person change against 1,263 is noise; against 40 it is a 1-in-40 guess,
   and small lists are small precisely because they are defined by a characteristic
   (chronic, veteran, youth), which already narrows who the person is.
6. **Fail closed.** Any gate failure means do not publish, keep serving the previous payload,
   and alarm. Never publish a partial or best-effort payload.
7. **Archive every published payload** with a timestamp, so "what was public on date X" is
   answerable.

### Honesty

- Never invent a number. If a value is unavailable, render it as unavailable with a reason.
- Every widget states its period and as-of date. The original dashboard's worst failure was
  showing four different denominators as though they were one population.
- If a fetch fails, show a visible staleness state. Never silently render cached data as
  current.

---

## Architecture (already decided, with reasons)

```
Looker (Clarity HMIS warehouse)
  │  pre-aggregated derived table, suppression in SQL
  ▼
Lambda  ← EventBridge Scheduler
  │  1. token, then run_look by ID
  │  2. GATE: allowlist → schema → cardinality → suppression → reconcile → PII scan
  │  3. fail closed
  ▼
s3://…-public/v1/data/latest.json        Cache-Control: max-age=60
              /v1/data/<period>-<ts>.json   archive
              /v1/chc.<hash>.js             immutable, max-age=31536000
  ▲ OAC
CloudFront → public
```

**CodeBuild builds the bundle only, triggered by code change.** Do not put the data refresh on
CodeBuild. At per-minute cadence that is 43,200 builds a month, roughly $216 minimum, and more
importantly it is a dependency-install-and-deploy-to-public-CDN path firing every minute with
no human in the loop. A compromised transitive dependency reaches production within the hour.

**Never invalidate CloudFront for data.** 43,200 invalidations a month is about $211. Use
`max-age=60` on `latest.json` and let it expire. The bundle is hash-named so it never needs
invalidating at all. Lambda at this cadence is roughly $1/month.

**Skip the S3 PUT when the payload hash is unchanged.** Saves writes and gives you a free
change log.

Cadence is not yet decided. Build so it is config: an EventBridge rate expression and a
`Cache-Control` value. Do not hardcode assumptions about it anywhere else.

---

## The data contract

Per-measure metadata is what makes cadence, precision and thresholds configurable later
instead of requiring edits to every widget.

```json
{
  "meta": {
    "schemaVersion": 1,
    "generated": "2026-07-31T14:04:00Z",
    "source": "Coalition HMIS via Looker"
  },
  "measures": {
    "activelyHomeless": {
      "value": 1263,
      "asOf": "2026-03-31T23:59:59Z",
      "cadence": "quarterly",
      "precision": "exact"
    }
  },
  "series": {
    "pitCount": {
      "asOf": "2026-01-29",
      "cadence": "annual",
      "points": [
        { "label": "2024", "total": 691, "sheltered": 503, "unsheltered": 188 },
        { "label": "2025", "total": 736, "sheltered": 541, "unsheltered": 195 },
        { "label": "2026", "total": 859, "sheltered": 637, "unsheltered": 222 }
      ]
    }
  },
  "breakdowns": {
    "raceEthnicity": {
      "asOf": "2026-03-31T23:59:59Z",
      "cadence": "quarterly",
      "universe": 1263,
      "minCell": 5,
      "categories": [{ "label": "White", "value": 679 }],
      "suppressed": { "count": 0, "value": 0 },
      "residual": { "label": "All other categories", "value": 99 }
    }
  }
}
```

`precision` is `exact` or `rounded5`. If rounding is ever switched on for a fast measure, the
widget must say so rather than presenting a rounded figure as exact.

---

## The embed contract

### Loading

```html
<script src="https://cdn.<domain>/v1/chc.<hash>.js" defer
        integrity="sha384-…" crossorigin="anonymous"></script>
```

Versioned path, SRI hash, single global side effect. The script scans for
`[data-chc]` elements on `DOMContentLoaded` and again via `MutationObserver` so widgets added
later still mount.

### Widgets

Start with these, each a pure function of the data payload:

| `data-chc` | Renders |
|---|---|
| `active-count` | Hero figure, people actively experiencing homelessness |
| `pit-trend` | Stacked columns, sheltered vs unsheltered by year |
| `inflow-outflow` | Paired bars plus the net gap |
| `race-ethnicity` | Sorted horizontal bars, single hue |
| `shelter-status` | 100% stacked bar |
| `length-of-stay` | Emphasis bars, local vs national |
| `retention` | Meter, 82% still housed at two years |
| `newly-homeless` | Column trend, 2020 to 2025 |
| `alice-gap` | Survival budget against median income |

This is also a widget that we build that closely mirrors what the Coalition already has I'd like it included as an option:

https://claude.ai/code/artifact/8200b7c3-8cd4-4494-b06e-e9e70c8fd8fc

### Parameters

| Attribute | Values | Default |
|---|---|---|
| `data-chc` | widget name | required |
| `data-theme` | `auto` \| `light` \| `dark` | `auto` |
| `data-variant` | `full` \| `compact` \| `figure-only` | `full` |
| `data-table` | `true` \| `false` | `true` |
| `data-segment` | `all` \| `veterans` \| `families` \| `youth` | `all` |
| `data-years` | integer | all available |
| `data-refresh` | `auto` \| `off` \| seconds | `auto` |
| `data-source` | override data URL | the CDN default |

`data-refresh="auto"` derives its interval from the payload's declared `cadence`. Do not poll
a quarterly measure every minute.

### Reactivity

- One shared fetch and one shared poll timer for the whole page regardless of widget count.
- A tiny store, subscribe on mount, unsubscribe on unmount.
- Update in place, never a layout jump. Hold the previous render while refetching.
- Respect `prefers-reduced-motion`.
- If a poll fails, keep the last good render and surface a staleness indicator with the
  as-of time. Never silently.

### Isolation (important)

The bundle runs on third-party pages including WordPress, whose CSS will otherwise destroy
it. **Render each widget into a Shadow DOM root** with styles scoped inside. No global CSS, no
global class names, no `window` pollution beyond one namespaced object. Assume the host page
has aggressive resets, `!important` rules, and its own box-sizing.

Also assume a strict host CSP: no inline styles injected into the host document, no `eval`,
no external fetches other than the configured data URL.

Size budget: aim under 30 KB gzipped for the whole bundle. No runtime dependencies.

---

## Design system

Palette is validated for colourblind separation in both themes. Do not substitute hexes
without re-validating.

**Series (categorical, max three plus grey)**

| Slot | Light | Dark |
|---|---|---|
| 1 | `#0044b5` | `#5082f0` |
| 2 | `#eb6834` | `#d95926` |
| 3 | `#1baf7a` | `#199e70` |
| unknown | `#b3bacb` | `#5c6478` |

**Ordinal ramp** (severity scales such as cost burden): light `#86b6ef` → `#2a78d6` →
`#0044b5`; dark `#184f95` → `#3987e5` → `#9ec5f4`.

**Surfaces and ink**

| Role | Light | Dark |
|---|---|---|
| plane | `#f4f6fa` | `#0b0d12` |
| surface | `#fafbfd` | `#12151c` |
| surface-2 | `#eef1f7` | `#1a1e27` |
| ink | `#12161f` | `#ffffff` |
| ink-2 | `#4a5265` | `#b4bccc` |
| muted | `#767e90` | `#838b9c` |
| grid | `#e2e6ef` | `#232833` |
| baseline | `#c6ccda` | `#333a47` |

**Brand:** United Way blue `#0044B5`, secondary `#5082F0`, gold `#FFBA00` (chrome only, it
fails the lightness band as a series colour), ink `#221E1F`. Their site uses **Antonio**
(headings) and **Palanquin** (body); the widgets should inherit host fonts by default with a
system-sans fallback.

**Chart rules already applied and worth keeping**

- No pie charts. The original had five and every one was the wrong form.
- One hue per single-series chart. Emphasis (accent plus grey) when one series is the point.
- Bars capped at 24px, 4px rounded data-end, square at the baseline.
- 2px surface gap between stacked segments. Subtract the gap from segment widths so the bar
  still sums to exactly 100% of its track.
- Legend for two or more series. Direct labels selectively, never a number on every point.
- Table view available for every chart. Tooltips enhance, never gate a value.
- Missing years render as labelled empty slots, never as a short bar.

---

## The real data

Everything below is transcribed from published Coalition material. Use it for fixtures and
tests. Nothing here is modelled or estimated.

**Point-in-Time count.** 2022: 690 total. 2024: 691 (503 sheltered, 188 unsheltered). 2025:
736 (541, 195). 2026: 859 (637, 222), counted 29 January 2026. 2023 not published in sources
seen. 2025 local rate 14 per 10,000 residents against a national 23 per 10,000 in 2024.

**Inflow and outflow, 2025.** Everyone: 3,577 became homeless, 3,358 housed or exited, net
+219. Veterans: 197 became homeless, 205 housed or exited, net −8.

**2025 outcomes.** 5,082 people served across 84,079 individual services. 1,360 exited to
positive housing outcomes. 82% still housed two years after support ends. 51 average days
homeless against a national average of 176 days in 2024. 565 people in priority populations
reviewed at weekly case conferencing. 205 veterans housed. $3.2M HUD Continuum of Care
funding. 25 member agencies, 16-member board.

**Newly homeless households.** 2020: 841. 2021: 1,086. 2022: 1,649. 2023: 1,430. 2024: 1,742.
2025: 2,077. Up 147% over six years.

**Age of unhoused individuals.** 2020: under 18 22.8%, 18–24 9.0%, 25–64 65.0%, 65+ 3.1%.
2025: under 18 12.4%, 18–24 9.7%, 25–64 71.5%, 65+ 6.3%.

**Disabling condition at intake.** 2023: 54%. 2024: 49%. 2025: 45%.

**ALICE, Sedgwick County, 2024.** 80,224 households below the threshold, 38% of all
households. Poverty 27,445, ALICE 52,779, above threshold 130,892. Median household income
$70,833. Survival budget for a family of four $76,512/yr. Stability budget $128,124/yr.
Owner cost burden: severely 9,840, burdened 7,466, not burdened 22,248. Renter cost burden:
severely 15,451, burdened 11,724, not burdened 16,851.

**HMIS active snapshot, Jan–Mar 2026.** 1,263 people actively experiencing homelessness on
31 March 2026. 197 in family households, 135 in youth households, 59 family households. Race
and ethnicity: White 679, Black or African American 343, Multi-racial 142, all other
categories 99 (four category labels are truncated in the public source and cannot be named
without workspace access). Shelter status: sheltered 720, unsheltered 322, doubled up 108,
other or unknown 113.

**Excluded, and why.** Do not publish these until reconciled: 1,478 households (exceeds the
1,263 person count, impossible); 6 youth-led households (implies 22.5 people each); length of
stay (resolves to a ~2,905 population, not 1,263); jail/prison release in past 7 days
(resolves to ~5,020); county of origin (57 people across 18 counties, of which nine hold
exactly one person). Three of these five likely share one cause: a visual filtered to a
different population than the headline.

---

## Ask the user these before building

1. **What does the queue count, and how many people are typically on it?** This decides
   whether a live public count is safe. Full active population around 1,263 is fine. A
   segmented by-name list under about 100 is not.
2. **Can Looker pre-aggregate and suppress in a derived table?** If yes, the strongest control
   is available and PII never enters AWS.
3. **Look ID and the field names it returns**, so the field mapping is real rather than
   guessed.
4. **AWS account, region, domain, and whether CDK, Terraform, or SAM.** Their AWS CLI uses SSO
   with profile `dev`.
5. **Is the fast-cadence view public or internal?** If it is the operational by-name list,
   that is a separate authenticated product, not a widget on this CDN.

---

## Looker API notes

`POST /api/4.0/login` with `client_id` and `client_secret` returns a bearer token, valid about
an hour. Cache it in a module-level variable across warm invocations.

`GET /api/4.0/looks/{id}/run/json?apply_formatting=false&cache=true&limit=5000`

- `apply_formatting=false` or you get `"1,263"` strings instead of numbers.
- `cache=true` serves Looker's cache rather than hitting the warehouse. At high cadence this
  is the difference between manageable load and hammering the HMIS warehouse.
- `limit` doubles as a cardinality tripwire: an aggregate query returning thousands of rows
  means someone changed the Look to return client-level data. Fail the run.
- Looker sometimes returns errors as HTTP 200 with an error key. Check the response shape, not
  just the status.

Prefer `run_look` against a saved, reviewed Look over an inline query built in code, so the
query is an auditable artifact. Use stdlib `urllib` rather than the SDK to keep the Lambda at
zero dependencies. Secret goes in Secrets Manager.

Alternative worth considering: Looker can push to S3 on a schedule via its S3 action, which
means no Looker credentials in AWS at all. Better security story, less timing control.

---

## Working style

The user prefers: no em dashes, no filler, no emojis, direct and factual. Delete over
preserve, execute over explain, act over ask. Never amend commits. Never merge a PR without
being asked. Run `git status` before committing, because pre-staged items get swept into
narrowly scoped commits.

They value verification highly and have been burned by plausible-looking work that was wrong:

- **Break every gate on purpose.** Do not report that suppression works because the code looks
  right. Turn on a chart with sub-threshold values and assert that no small cell reaches the
  DOM.
- **Re-measure every number.** Derived percentages and bar geometry drifted from their values
  repeatedly during design. Compute geometry from data, then assert the rendered pixels match.
- **Render it and look at it** before calling a chart done.
- Report null over a plausible wrong number. A guard that proceeds on error amplifies the
  outage.

---

## Definition of done

- SAM Template clean, infrastructure deployable.
- Lambda runs against a Looker fixture and publishes valid JSON.
- **Gate tests that try to defeat it**: a payload with a sub-threshold cell, a payload with an
  unknown field, a payload whose categories exceed the universe, a payload with a client ID
  in it. Each must fail the run and leave the previous payload serving.
- CodeBuild produces a hash-named bundle under 30 KB gzipped with an SRI hash.
- Every widget renders in light and dark, at 390px and 1280px, inside a Shadow DOM on a page
  with hostile CSS.
- No horizontal page scroll at any width, zero external requests beyond the data URL, no
  console errors.
- A staleness state that is visible when the fetch fails.
- README covering deploy, quarterly refresh, and how to add a widget.
