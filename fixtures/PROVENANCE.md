# Provenance

Every figure in every valid fixture, and where it came from.

Nothing in a valid fixture is modelled, estimated or invented. A figure that cannot be traced
to published Coalition material does not go in a fixture, and `tests/gate/test_provenance.py`
parses the Figure column below and fails the suite for any count position in
`fixtures/valid/*.json` that is not listed here.

## How to read this

- **Figure** is the integer as it appears in the payload, with no thousands separator, so the
  test can parse it exactly. The printed form is in the Source column where it differs.
- **Id** is the key it appears under.
- **Source** names the document and the tile or line it was transcribed from.

Rows may also record a figure that explains a published one without itself being published,
such as the decomposition of a residual. Those are marked as such in the Source column. The
test asserts that every published figure is listed, not that every listed figure is published,
so an explanatory row is legitimate.

## Hostile fixtures are not covered here

`fixtures/hostile/` is fabricated on purpose and is not sourced. Where a hostile fixture reuses
a real figure it is because the attack is about that figure, and the fixture's test says so.

## live.json

| Figure | Id | Source |
|---|---|---|
| 1308 | `queueTotal` | `docs/reference/community-queue-overview.png`, the "Clients Currently on Community Queue" tile, printed as 1,308. Corroborated by `docs/PLAN.md` 4.5, which lists "Clients currently on CQ 1,308" and rules it publishable at live cadence. |

The Community Queue total is the only figure the live file may carry. `docs/PLAN.md` 4.5 is
explicit that the size of the queue publishes and its shape does not, so the veteran, chronic,
youth and older adult counts on the same tile are weekly figures and are absent here by
design rather than by omission.

The same dashboard prints "1,308 Households" directly beneath the client count. That figure is
excluded rather than unpublished, as `cqHouseholds` in `gate/contract.py`, because 1,308
households against 1,308 clients cannot both be right on a dashboard that also reports 6
parenting youth households.

## weekly.json

The shape of the Community Queue, read from the same dashboard image as the live total and at the
same moment, which is why every `asOf` here is the one `live.json` carries.
`docs/PLAN.md` 4.5 is the ruling on what may appear: publish the size of the queue at speed and
its shape a week behind, so these are the tiles it marks Weekly and nothing else.

| Figure | Id | Source |
|---|---|---|
| 532 | `chronicallyHomelessOnCq` | `docs/reference/community-queue-overview.png`, the "Chronically Homeless Clients Currently on CQ" tile. `docs/PLAN.md` 4.5 tile table: 532, Weekly. |
| 71 | `unaccompaniedYouthOnCq` | `docs/reference/community-queue-overview.png`, Youth Summary, "Unaccompanied Youth Clients". `docs/PLAN.md` 4.5: 71, Weekly, and the measure it says covers the youth story adequately on its own. |
| 28 | `veteransOnCq` | `docs/reference/community-queue-overview.png`, the "Veterans Currently on CQ" tile. `docs/PLAN.md` 4.5: 28, Weekly, never at speed. Above `MIN_CELL`, and the live population floor applies to fast measures only. |
| 318 | `totalOlderAdultsAndSeniorsOnCq`, `olderAdultsOnCq` universe | `docs/reference/community-queue-overview.png`, Older Adults/Seniors Summary, "Total Older Adults and Seniors". Printed as its own figure, which is the only reason the breakdown beneath it can be registered at all. ADR 9. |
| 181 | `olderAdultsOnCq`, Age 55 to 61 | `docs/reference/community-queue-overview.png`, "Older Adults (Age 55 - 61)". `docs/PLAN.md` 4.5: 181, Weekly. |
| 137 | `olderAdultsOnCq`, Age 62 and over | `docs/reference/community-queue-overview.png`, "Seniors (Age 62+)". `docs/PLAN.md` 4.5: 137, Weekly. |
| 173 | `averageDaysOnCq` | `docs/reference/community-queue-overview.png`, "Average Length of Time (Days) on CQ". Kind `average`: 173 days is not 173 people, so `MIN_CELL` and reconciliation do not apply to it. |

181 + 137 = 318, recomputed, and 318 is also the independently printed tile the breakdown binds
to. That is what makes the reconciliation non-tautological: the denominator is a figure somebody
published rather than the sum of the two categories under it.

Three tiles on the same dashboard are absent, each excluded rather than unpublished, and all
three appear only as hostile fixtures:

| Tile | Value | Why it is unpublishable |
|---|---|---|
| Parenting Youth Households | 6 | Six is one bad week above `MIN_CELL`, so a weekly series would read `6, 6, 5, [withheld], 5` and the act of suppressing would itself disclose that the withheld week was four or fewer. `docs/PLAN.md` 4.5, "the flicker problem". |
| Clients Currently on a CQ Multiple Times | 1 | A count of one specific person, and an operational data quality metric whose purpose is telling staff to merge a duplicate record. No public meaning at any cadence. |
| Households | 1,308 | 1,308 households against 1,308 clients on a dashboard that also reports 6 parenting youth households. A parenting youth household is not one person, so the two cannot both be right. |

## monthly.json

Monthly referrals to the Community Queue, read from the bar labels of the "Monthly Referrals to
CQ" chart in `docs/reference/community-queue-overview.png`. Every bar prints its own value above
it, so these are transcribed rather than measured off the geometry.

The month mapping comes from the axis labels, which sit on every second bar: "January '25" under
bar 2, "March" under bar 4, and "July" under bar 20. That places bar 1 at December 2024 and bar
20 at July 2026. Three independent readings agree on the twenty values and on this alignment: the
planner's, the plan reviewer's, and the implementer's at the point of writing this file.

| Figure | Id | Source |
|---|---|---|
| 81 | `cqReferrals` 2024-12 | `docs/reference/community-queue-overview.png`, Monthly Referrals to CQ, bar 1. |
| 10 | `cqReferrals` 2025-01 | Bar 2, under the "January '25" axis label. |
| 38 | `cqReferrals` 2025-05 | Bar 6, under the "May" axis label. |
| 35 | `cqReferrals` 2025-06 | Bar 7. |
| 15 | `cqReferrals` 2025-07 | Bar 8, under the "July" axis label. |
| 23 | `cqReferrals` 2025-08 | Bar 9. |
| 7 | `cqReferrals` 2025-09 | Bar 10, under the "September" axis label. Above `MIN_CELL`, so it publishes. |
| 58 | `cqReferrals` 2025-10 | Bar 11. |
| 45 | `cqReferrals` 2025-11 | Bar 12, under the "November" axis label. |
| 71 | `cqReferrals` 2025-12 | Bar 13. |
| 49 | `cqReferrals` 2026-01 | Bar 14, under the "January '26" axis label. |
| 72 | `cqReferrals` 2026-02 | Bar 15. |
| 117 | `cqReferrals` 2026-03 | Bar 16, under the "March" axis label. |
| 160 | `cqReferrals` 2026-04 | Bar 17. |
| 147 | `cqReferrals` 2026-05 | Bar 18, under the "May" axis label. |
| 177 | `cqReferrals` 2026-06 | Bar 19. |
| 206 | `cqReferrals` 2026-07 | Bar 20, under the "July" axis label. |
| 7 | `cqReferrals`, withheld residual | 2 + 2 + 3, the three withheld months summed. Arithmetic over transcribed bar values, not a figure read from anywhere. |
| 1318 | `cqReferrals`, total | 1311 published plus 7 withheld. Arithmetic over the twenty transcribed bars, recomputed rather than read. See below on why a derived total is published here and a derived net is not. |

### The three withheld months

Bars 3, 4 and 5 print 2, 2 and 3, which is February, March and April 2025. All three are below
`MIN_CELL`. `docs/PLAN.md` 4.5 names them as "roughly 2, 2 and 3 in early 2025" and takes the
conservative call: suppression applies.

| Figure | Id | Source |
|---|---|---|
| 2 | `cqReferrals` 2025-02 | Bar 3. Below `MIN_CELL`, withheld, and absent from the payload. Recorded here and nowhere else. |
| 2 | `cqReferrals` 2025-03 | Bar 4, under the "March" axis label. Below `MIN_CELL`, withheld. |
| 3 | `cqReferrals` 2025-04 | Bar 5. Below `MIN_CELL`, withheld. |

**None of these three appears in the payload.** Each is emitted as
`{"label": "2025-02", "withheld": true}` with no `value` key at all, and their sum is carried in
`withheld: {"count": 3, "value": 7}` so the total still reconciles. They are listed here because
this file is the record of where every figure came from, including the ones the payload refuses
to carry, and because a reader checking 1311 + 7 = 1318 needs to see what the 7 is made of.

The counter-argument is on the record and is reasonable: a monthly referral count is an event
count with no characteristic attached, so "2 people were referred in March 2025" names nobody.
`MIN_CELL` exists for category cells where the category is itself a descriptor. Applying it here
costs three points out of twenty and is the conservative default until somebody with the
underlying data says otherwise. If they do, the change is to this file and the fixture, not to
the gate.

### Why `total` is published and a net is not

ADR 10 refuses derived values, and 1318 is arithmetic rather than a transcribed figure, so the
distinction is worth stating. Inflow minus outflow is a new claim: it is signed, it appears
nowhere in published material, and nothing in the payload lets a reader check it. A series total
is the sum the series already accounts for, it is what the withheld residual reconciles against,
and check 7 recomputes it from the points in the same payload on every run. Without it the three
withheld months would be silently missing rather than accounted for, which is the failure
withholding exists to avoid.

## quarterly.json

The HMIS active snapshot for 1 January to 31 March 2026, transcribed from `docs/HANDOFF.md`
"The real data", the paragraph beginning "HMIS active snapshot". `docs/FINDINGS.md` audited the
dashboard these figures come from and its summary table classifies each of them: the four
measures are "Sound" and both breakdowns are "Readable in part". The five elements it says
cannot be republished are excluded in `gate/contract.py` and appear nowhere below.

| Figure | Id | Source |
|---|---|---|
| 1263 | `activelyHomeless` | `docs/HANDOFF.md` "The real data", printed as 1,263 people actively experiencing homelessness on 31 March 2026. `docs/FINDINGS.md` summary table: Sound. Its denominator table confirms race and shelter both resolve to it. |
| 197 | `personsInFamilyHouseholds` | `docs/HANDOFF.md` "The real data", 197 in family households. `docs/FINDINGS.md`: Sound. |
| 135 | `personsInYouthHouseholds` | `docs/HANDOFF.md` "The real data", 135 in youth households. `docs/FINDINGS.md`: Sound. |
| 59 | `familyHouseholds` | `docs/HANDOFF.md` "The real data", 59 family households. `docs/FINDINGS.md`: Sound, and 197 over 59 resolves at 3.3 people each. |
| 679 | `raceEthnicity`, White | `docs/HANDOFF.md` "The real data", White 679. `docs/FINDINGS.md` denominator table gives 679 at 53.76%, which back-solves to 1,263. |
| 343 | `raceEthnicity`, Black or African American | `docs/HANDOFF.md` "The real data", Black or African American 343. |
| 142 | `raceEthnicity`, Multi-racial | `docs/HANDOFF.md` "The real data", Multi-racial 142. |
| 99 | `raceEthnicity`, residual | `docs/HANDOFF.md` "The real data", all other categories 99, where the four truncated labels go. |
| 720 | `shelterStatus`, Sheltered | `docs/HANDOFF.md` "The real data", sheltered 720. `docs/FINDINGS.md` denominator table gives 720 at 57.01%, which back-solves to 1,263. |
| 322 | `shelterStatus`, Unsheltered | `docs/HANDOFF.md` "The real data", unsheltered 322. |
| 108 | `shelterStatus`, Doubled up or couch surfing | `docs/HANDOFF.md` "The real data", doubled up 108. |
| 113 | `shelterStatus`, residual | `docs/HANDOFF.md` "The real data", other or unknown 113. Decomposition and its unresolved half below. |
| 0 | every `suppressed` block | Not transcribed. A statement about what the publisher suppressed for `MIN_CELL` reasons, which is nothing. See below. |

679 + 343 + 142 + 99 = 1263 and 720 + 322 + 108 + 113 = 1263. Both recomputed rather than
inherited from the plan.

### `suppressed` is zero, and that is a fact rather than a placeholder

`suppressed: {count: 0, value: 0}` says the **publisher** folded no cell for `MIN_CELL` reasons.
The residual says something different: the source did not name these categories. Conflating the
two would claim small cells were folded when the real cause is an unreadable public embed, so
they are two fields carrying two facts.

### What the shelter status residual of 113 contains, and what is not settled

`docs/FINDINGS.md` "The shelter status labels cannot all be correct" records four labeled slices
totalling 1,183 of 1,263, leaving 80 across two categories it cannot name. `docs/HANDOFF.md`
transcribes three of those four cleanly (720, 322, 108, which sum to 1,150), so the fourth
labeled slice is 1,183 minus 1,150, or 33. The residual of 113 is therefore 33 + 80.
`site/dashboard.html`'s `unknownNote` records the same fold, distinguishing the reported
other-or-unknown count from values that could not be read from the public embed.

| Figure | Id | Source |
|---|---|---|
| 33 | `shelterStatus`, the fourth labeled slice | Derived, not transcribed, and not published. `docs/FINDINGS.md` four labeled slices total 1,183; `docs/HANDOFF.md` gives three of them summing to 1,150. Explains the residual, is not a category. |
| 80 | `shelterStatus`, the two categories the audit cannot name | Derived, not transcribed, and not published. 1,263 minus 1,183 from `docs/FINDINGS.md`. Explains the residual, is not a category. |

**Neither 33 nor 80 may ever become a published category.** Naming them would name categories the
source does not name, and it would break the property that makes the residual safe: its members
are unnamed and combined, so no small cell is published whichever way the 80 splits. Nobody knows
how it splits, and one of the two could be below `MIN_CELL`. `shelterStatus` publishes three
named categories and one residual of 113. Nothing else.

**The unresolved half.** `docs/FINDINGS.md` states a disjunction: either the legend is not
size-sorted, or a label is attached to the wrong slice. The decomposition above confines the
truncation horn to the residual. It does not settle the mislabeling horn, and nothing in
`docs/FINDINGS.md` confines that one: `Sheltered` at 720 is not ruled out as the mislabeled
slice. The audit could not settle it because it had the public embed and published documents
only. ADR 17 in `docs/plans/2026-08-01-publisher/Phase-0.md` records the residual risk being
accepted, which is publishing three named categories from a source whose own audit says a label
may sit on the wrong slice, and records that a named category is among the things that could
change if anyone ever gets workspace access.

## annual.json

The Coalition's own reporting, transcribed from `docs/HANDOFF.md` "The real data". The largest
payload the system carries: 137 leaf values against a ceiling of 512.

| Figure | Id | Source |
|---|---|---|
| 3577 | `inflow` | `docs/HANDOFF.md` "Inflow and outflow, 2025", 3,577 became homeless. Corroborated by `docs/FINDINGS.md` section 6, which names it the functional-zero measure the dashboard omits. |
| 197 | `inflow`, veterans segment | `docs/HANDOFF.md` "Inflow and outflow, 2025", veterans 197 became homeless. |
| 3358 | `outflow` | `docs/HANDOFF.md` "Inflow and outflow, 2025", 3,358 housed or exited. |
| 205 | `outflow`, veterans segment | `docs/HANDOFF.md` "Inflow and outflow, 2025", veterans 205 housed or exited, and "205 veterans housed" in the 2025 outcomes paragraph. |
| 5082 | `peopleServed` | `docs/HANDOFF.md` "2025 outcomes", 5,082 people served. |
| 84079 | `servicesDelivered` | `docs/HANDOFF.md` "2025 outcomes", across 84,079 individual services. |
| 1360 | `positiveHousingExits` | `docs/HANDOFF.md` "2025 outcomes", 1,360 exited to positive housing outcomes. |
| 565 | `peopleReviewedAtCaseConferencing` | `docs/HANDOFF.md` "2025 outcomes", 565 people in priority populations reviewed at weekly case conferencing. |
| 82 | `housingRetentionTwoYears` | `docs/HANDOFF.md` "2025 outcomes", 82% still housed two years after support ends. |
| 51 | `averageDaysHomeless` | `docs/HANDOFF.md` "2025 outcomes", 51 average days homeless. Not the excluded Power BI length-of-stay distribution, which resolves to a different population. |
| 176 | `nationalAverageDaysHomeless` | `docs/HANDOFF.md` "2025 outcomes", a national average of 176 days in 2024. |
| 690 | `pitCount` 2022 | `docs/HANDOFF.md` "Point-in-Time count", 2022: 690 total. |
| 691 | `pitCount` 2024 | `docs/HANDOFF.md` "Point-in-Time count", 2024: 691. Corroborated by `docs/FINDINGS.md` section 6. |
| 503 | `pitCount` 2024, sheltered | `docs/HANDOFF.md` "Point-in-Time count", 2024: 503 sheltered. |
| 188 | `pitCount` 2024, unsheltered | `docs/HANDOFF.md` "Point-in-Time count", 2024: 188 unsheltered. |
| 736 | `pitCount` 2025 | `docs/HANDOFF.md` "Point-in-Time count", 2025: 736. |
| 541 | `pitCount` 2025, sheltered | `docs/HANDOFF.md` "Point-in-Time count", 2025: (541, 195). |
| 195 | `pitCount` 2025, unsheltered | `docs/HANDOFF.md` "Point-in-Time count", 2025: (541, 195). |
| 859 | `pitCount` 2026 | `docs/HANDOFF.md` "Point-in-Time count", 2026: 859, counted 29 January 2026. `docs/FINDINGS.md` section 6 calls it the year's actual headline. |
| 637 | `pitCount` 2026, sheltered | `docs/HANDOFF.md` "Point-in-Time count", 2026: (637, 222). |
| 222 | `pitCount` 2026, unsheltered | `docs/HANDOFF.md` "Point-in-Time count", 2026: (637, 222). |
| 841 | `newlyHomelessHouseholds` 2020 | `docs/HANDOFF.md` "Newly homeless households", 2020: 841. |
| 1086 | `newlyHomelessHouseholds` 2021 | `docs/HANDOFF.md` "Newly homeless households", 2021: 1,086. |
| 1649 | `newlyHomelessHouseholds` 2022 | `docs/HANDOFF.md` "Newly homeless households", 2022: 1,649. |
| 1430 | `newlyHomelessHouseholds` 2023 | `docs/HANDOFF.md` "Newly homeless households", 2023: 1,430. |
| 1742 | `newlyHomelessHouseholds` 2024 | `docs/HANDOFF.md` "Newly homeless households", 2024: 1,742. |
| 2077 | `newlyHomelessHouseholds` 2025 | `docs/HANDOFF.md` "Newly homeless households", 2025: 2,077. |
| 54 | `disablingConditionAtIntake` 2023 | `docs/HANDOFF.md` "Disabling condition at intake", 2023: 54%. |
| 49 | `disablingConditionAtIntake` 2024 | `docs/HANDOFF.md` "Disabling condition at intake", 2024: 49%. |
| 45 | `disablingConditionAtIntake` 2025 | `docs/HANDOFF.md` "Disabling condition at intake", 2025: 45%. |
| 80224 | `aliceHouseholdsBelowThreshold`, `aliceThreshold` universe | `docs/HANDOFF.md` "ALICE, Sedgwick County, 2024", 80,224 households below the threshold. |
| 130892 | `aliceHouseholdsAboveThreshold` | `docs/HANDOFF.md` "ALICE, Sedgwick County, 2024", above threshold 130,892. |
| 70833 | `medianHouseholdIncome` | `docs/HANDOFF.md` "ALICE, Sedgwick County, 2024", median household income $70,833. |
| 76512 | `survivalBudgetFamilyOfFour` | `docs/HANDOFF.md` "ALICE, Sedgwick County, 2024", survival budget for a family of four $76,512 a year. |
| 128124 | `stabilityBudgetFamilyOfFour` | `docs/HANDOFF.md` "ALICE, Sedgwick County, 2024", stability budget $128,124 a year. |
| 27445 | `aliceThreshold`, Poverty | `docs/HANDOFF.md` "ALICE, Sedgwick County, 2024", Poverty 27,445. |
| 52779 | `aliceThreshold`, ALICE | `docs/HANDOFF.md` "ALICE, Sedgwick County, 2024", ALICE 52,779. |

503 + 188 = 691, 541 + 195 = 736, 637 + 222 = 859, and 27445 + 52779 = 80224. All recomputed.

`aliceThreshold` is the one breakdown with no residual. Poverty and ALICE are exhaustive and both
are named, and `residual` is the only optional key on a breakdown. `suppressed` is still required
and is still zero.

### Absent from annual.json on purpose

Each was available and each is left out for a recorded reason, so its absence reads as a decision
rather than an omission.

| Figure | What it is | Why it is absent |
|---|---|---|
| 9840, 7466, 22248 | ALICE owner cost burden | ADR 9. Its universe of 39,554 appears in no published material and would have to be summed from the categories, which is invention. |
| 15451, 11724, 16851 | ALICE renter cost burden | ADR 9. Same, with a universe of 44,026. |
| n/a | Age of unhoused individuals | ADR 9. Published only as percentages summing to 99.9, and reconciliation is exact with no tolerance. |
| $3.2M | HUD Continuum of Care funding | ADR 10. Published as $3.2M, rounded to two significant figures, and `precision` is permanently `exact`. |
| +219 | Inflow minus outflow, everyone | ADR 10. Derived. Widgets compute it from 3,577 and 3,358. |
| n/a | Inflow minus outflow, veterans | ADR 10. Derived, and the only signed value that would appear anywhere. |
| n/a | 14 per 10,000 rate | ADR 10. Derived. |
| n/a | 25 member agencies, 16-member board | Organisational facts rather than figures about the population, and no registry entry claims them. |

`tests/gate/test_contract.py` asserts the first five rows twice over: that no such id is
registered, and that the figures themselves appear in no valid fixture under any other id.
