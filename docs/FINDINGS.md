# Data & Reports page: review findings

**Subject:** the embedded Power BI dashboard and surrounding page at
`unitedwayplains.org/coalition-to-end-homelessness-in-wichita-sedgwick-county/data-and-reports/`
**Reviewed:** 31 July 2026
**Access:** public embed and published documents only. No Power BI workspace access.

## Method

Figures were read from the rendered report, and where the report prints no values they were
derived by measuring bar geometry. Every denominator below was back-solved by dividing a
chart's own printed count by its own printed percentage. Anything I could not confirm is
marked unverified rather than asserted.

## Summary

The report has eleven elements. Four are sound, two are partially readable, and five cannot
be republished as they stand.

| Element | Status |
|---|---|
| 1,263 persons actively homeless | Sound |
| 197 persons in family households | Sound |
| 135 persons in youth households | Sound |
| 59 family households | Sound |
| Race and ethnicity | Readable in part, four category labels truncated |
| Shelter status | Readable in part, two category labels truncated |
| 1,478 households | Contradicts the person count |
| 6 youth-led households | Implausible against 135 people |
| Length of stay | Wrong population |
| Jail/prison release in past 7 days | Wrong population |
| County of origin | Publishes individuals |

---

## 1. Data integrity

### Four different denominators presented as one population

The headline says 1,263 people. Two charts agree. Two do not, and nothing on the canvas
signals the difference.

| Visual | Printed values | Implied population |
|---|---|---|
| Headline card | 1,263 | **1,263** |
| Race and ethnicity | 679 at 53.76% | **1,263** |
| Shelter status | 720 at 57.01% | **1,263** |
| Length of stay | 2,382 at 82.02% | **~2,905** |
| Jail/prison release | 4,912 at 97.95% | **~5,020** |

Length of stay is 2.3 times the headline population. Jail/prison release is about four
times it. A reader comparing them against the headline draws a false conclusion, and a
funder or reporter checking the arithmetic finds it immediately.

### More households than people

The report shows **1,478 households** against **1,263 people**. The same page defines a
household as "one or more people who live are living together." There cannot be more
households than people, so the two figures are counting different periods or different
populations.

### Youth households do not reconcile

**135 people** in youth households against **6 youth households** is 22.5 people per
household. Family households resolve sensibly at 197 over 59, which is 3.3 each, so the
problem is specific to the youth measure rather than to household counting generally.

### The shelter status labels cannot all be correct

Four labeled slices total 1,183 of 1,263, leaving 80 across two unlabeled categories. If
the legend is sorted by size, each of those two must be at or below 33, which caps them at
66 combined. Either the legend is not size-sorted or a label is attached to the wrong
slice.

### No time dimension anywhere

Nothing in the report shows change over time. For a coalition working toward functional
zero, inflow against outflow is the measure that determines whether the work is
succeeding, and the report carries neither it nor any trend line.

### The report is undated inside itself

The embed is titled "Homeless_Services_Dashboard July 2026" while its content covers
January to March 2026. There is no as-of date on the canvas, so anyone who opens the Power
BI link directly gets numbers with no period attached to them.

---

## 2. Privacy

### Nine counties published with exactly one person each

The county of origin chart prints no values, so the counts were derived by measuring bar
widths. The ratios resolve to clean integers:

```
15, 9, 6, 5, 4, 3, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1     (18 counties, 57 people)
```

That means **nine named Kansas counties each contribute exactly one person**, published
anonymously from HMIS-derived data. In a rural county, one person experiencing
homelessness in Wichita is plausibly identifiable to anyone who knows them. Suppressing
cells below five is the standard mitigation and costs the reader nothing, because the
story is "most people were already here, a few dozen came from nearby counties."

### Publish-to-web is anonymous by design

The link is the credential. No login, no record of who retrieves the data, and the content
is shareable and cacheable. For HMIS-derived figures this is a governance decision rather
than a technical one.

### Cross-filtering status is unverified

Power BI enables cross-filtering by default. If it is on, clicking a small slice on one
chart filters the county chart further and can drive cells to one even where the source
data would not. My click test did not register, so **this is flagged, not confirmed.** It
needs checking in the workspace.

---

## 3. Chart choices

- **Five pie charts, none of which earn it.** Race has eight categories, four of them too
  small to see. Length of stay is 82% a single slice. Jail/prison release is 98 against 2,
  which is one number drawn as a pie.
- **A sequential ramp used for nominal categories.** White, Black or African American,
  Multi-racial and Hispanic are all shades of the same blue. The lighter steps fail
  contrast, and color is the only thing distinguishing them.
- **Legend labels cut off mid-word.** "Black, Africa…", "Sheltered- No …", "Was this client
  r…". Readers cannot tell what several categories are.
- **Underlined all-caps titles** read as broken hyperlinks.
- **The bottom third of the canvas is empty.**

---

## 4. Mobile

The embed is a hardcoded `<iframe width="1200" height="747">`.

| Viewport | Container | Iframe | Result |
|---|---|---|---|
| 390 px phone | 330 px | 1200 px | Roughly two thirds off-screen, unreachable, no scroll |
| 1440 px desktop | 1170 px | 1200 px | Overflows its column by 30 px |

On a phone the entire right-hand column, including county of origin, is simply not
reachable. This cannot be fixed in place: publish-to-web renders the desktop canvas and
ignores Power BI's phone layout, so the embed will not reflow.

---

## 5. Page copy

- The acronyms ES, CE, PH, RRH, SH, SO and TH appear in the paragraph **above** the
  glossary that defines them.
- The glossary contains "SH: Safe Haven (we don't have any of these)", an internal note
  sitting in public copy. A program type not in use does not belong in a public glossary.
- "One or more people who live are living together" is a typo.
- The page promises "monthly dashboards" in two places and delivers quarterly.
- Three data vintages sit together with no orientation: 2025 outcomes, the 2026 report, and
  a Q1 2026 dashboard.

---

## 6. What the dashboard leaves out

Found in the Coalition's own 2026 State of Homelessness Report, absent from the dashboard.

- **The year's actual headline.** The 2026 Point-in-Time count is **859**, up from 736 in
  2025 and 691 in 2024. A 16.7% rise, and none of it appears on the dashboard.
- **The functional-zero measure.** Inflow **3,577** against outflow **3,358**, so 219 more
  people entered homelessness than left it in 2025. This is the Coalition's own definition
  of whether the work is succeeding.
- Minor: the 2025 press release describes a 45-person rise as "a 6.11% increase." That is
  45 divided by the new total. Measured against the prior year's 691 it is 6.51%.

---

## Where to start

Three of the five broken elements fail the same way: a visual filtered to a different
population than the headline. **That is likely one fix rather than three.** With workspace
access, compare page-level against visual-level filters on length of stay, jail/prison
release and households before touching anything else.

Priority order:

1. Reconcile the denominators. Everything else inherits this.
2. Suppress county cells below five, and check the cross-filter setting.
3. Name the four truncated race and ethnicity categories. Leaving American Indian and
   Alaska Native people inside an unnamed remainder hides exactly the disparity the chart
   exists to surface.
4. Fix the embed sizing, or replace the embed.
5. Copy edits on the surrounding page.

## Confidence

**Verified by arithmetic or measurement:** all denominators, the household and youth
contradictions, the county counts, the iframe dimensions, and that the report is a single
page.

**Flagged but not confirmed:** whether cross-filtering is enabled, and the identity of the
four truncated race and ethnicity categories. Both need workspace access.
