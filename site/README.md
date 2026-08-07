# Coalition to End Homelessness — data page concept

A standalone redesign concept for the Data & Reports page on unitedwayplains.org.
Single self-contained HTML file. No build step, no dependencies, no external requests.

Deployed: `https://staging.d2g6aqspgjifxk.amplifyapp.com/`

This page is also the design system for the widget platform. See `../docs/PLAN.md` section 9.

## Files

| File | What it is |
|---|---|
| `index.html` | The Data & Reports page. Annual narrative, updated when the report is. Values are inline in the markup. |
| `dashboard.html` | Replacement for the embedded Power BI dashboard. Quarterly. Renders from a single `DATA` block. |
| `../amplify.yml` | Amplify Hosting build spec (no build) plus security and cache headers. Lives at the repo root in monorepo format with `appRoot: site`. |

The two are deliberately built differently. `index.html` changes about once a year and
reads top to bottom, so its numbers live in the markup. `dashboard.html` changes every
quarter, so its numbers live in one JS object and every label, percentage, bar width and
table row is derived from them. Geometry cannot drift out of step with the values.

## Updating the dashboard each quarter

Edit the `DATA` object at the bottom of `dashboard.html`. Nothing else.

```js
quarters: [
  { label: 'Jan–Mar 2026', persons: 1263, familyPersons: 197, youthPersons: 135, familyHouseholds: 59 },
  { label: 'Apr–Jun 2026', persons: ____, familyPersons: ___, youthPersons: ___, familyHouseholds: __ }
]
```

Push a second quarter and the trend chart appears on its own. It is currently showing an
empty state because only one quarter is on file.

Residuals are computed, not entered. `raceEthnicity` and `shelterStatus` each take the
named categories and a `universe`; the renderer derives the remainder, so the chart always
reconciles to the universe exactly and a missing category cannot silently vanish.

### Small-cell suppression

`MIN_CELL = 5` sits above the renderers. Any category below it is folded into an unnamed
combined bucket by `suppress()` before it can reach the DOM. This is a property of the
renderer rather than something anyone has to remember at publication time.

Verified by turning `countyOfOrigin.enabled` on and confirming that of the 18 counties,
only the four at 5 or more are named, with 14 counties totalling 22 people combined. No
county below the threshold reached the DOM.

## Deploying

**Amplify Hosting, manual deploy (fastest)**

```
zip -r site.zip index.html dashboard.html
```

Amplify console → Host a web app → Deploy without Git → drag `site.zip`.

A manual deploy never runs a build spec, so the headers in `../amplify.yml` do
not apply. To carry them, set them in the console under **Custom headers**, or
add a `customHttp.yml` at the root of the deployed artifact.

**Amplify Hosting from a repo**

`amplify.yml` sits at the repo root in Amplify's monorepo format
(`applications: - appRoot: site`). Connect the branch, then set the app's root
directory to `site` in the console. Amplify will not match the application
otherwise. `baseDirectory: /` is relative to `appRoot`, so it serves this
directory as-is.

**S3 static website + Amplify/CloudFront**

```
aws s3 cp index.html s3://<bucket>/index.html \
  --content-type "text/html; charset=utf-8" \
  --cache-control "public, max-age=0, must-revalidate" \
  --profile dev
```

Set `index.html` as the index document. Keep the bucket private and reach it
through the CDN with an Origin Access Control rather than making it public.
Headers in `amplify.yml` only apply to Amplify Hosting; on a raw
S3 + CloudFront setup, attach a CloudFront response headers policy instead.

## Before this goes anywhere public

1. **The disclaimer block stays until the Coalition signs off.** It is the first
   element inside `<div class="wrap">`, marked `<div class="disclaimer">`. The page
   uses United Way's brand colors and their published figures; without that block
   it reads as an official United Way page, which it is not.
2. `<meta name="robots" content="noindex, nofollow">` is set on purpose. Remove it
   only when the page is authorized and final, otherwise it will compete with the
   real page in search results.
3. Fonts are a system stack standing in for the site's **Antonio** (headings) and
   **Palanquin** (body). If this ever merges into unitedwayplains.org, both are
   already loaded there and it will pick them up by changing `--sans`.

## Where the numbers come from

Every figure is transcribed from published Coalition material. Nothing is modeled
or estimated.

- **2026 State of Homelessness Report** (PDF, 8pp) — PIT counts 2024–2026 with
  sheltered/unsheltered splits, inflow and outflow, newly homeless households
  2020–2025, age demographics, disabling conditions, 2025 outcomes.
  `unitedwayplains.org/download/251/coalition-to-end-homelessness/27499/2026-state-of-homelessness-report_final`
- **2026 State of ALICE in Kansas Report** (via the above) — ALICE budgets,
  threshold counts, housing cost burden. 2024 reporting period.
- **Coalition Power BI dashboard** — the Jan–Mar 2026 HMIS snapshot: 1,263 active,
  race and ethnicity, shelter status.
  `app.powerbi.com/view?r=eyJrIjoiZDFkMWUxOTEtNTQyNy00NTQ4LTg5NjQtZmZiMDc1ZmE3NWY2IiwidCI6Ijk5MGM4YTI1LTY5MmMtNGRlNy1iYTExLWZlMzUxNDQzYjk1OCJ9`

### Known gaps, carried over from the source

- **Race and ethnicity is incomplete.** The public embed truncates four legend
  labels, so three categories are named and the remaining 99 people are combined.
  American Indian and Alaska Native people are heavily over-represented in
  homelessness nationally; leaving them inside an unnamed remainder is not an
  acceptable end state. Needs the underlying dataset.
- **Three dashboard figures were left off** because they do not reconcile:
  households actively homeless (1,478 against 1,263 people), length of stay
  (~2,905 population), and jail/prison release (~5,020 population).
- **County of origin was left off.** The live embed publishes nine Kansas counties
  with exactly one person each, from HMIS-derived data, with no login. Any version
  of that chart needs small-cell suppression first.

## Maintenance

`index.html` is the source of truth. Values are inline in the markup: bar widths and
column heights are percentages of a stated scale, and each chart's scale is noted in
a comment above it. When updating a number, update the label, the geometry, and the
table-view row together.

## Verified

- No horizontal overflow at 1280 / 768 / 390 px
- Zero external network requests
- No console errors
- Theme toggle works both directions and persists across reload
- Series palettes pass the light and dark colorblind-separation gates
  (3-slot categorical all-pairs, 2-slot stack, 3-step ordinal ramp)
