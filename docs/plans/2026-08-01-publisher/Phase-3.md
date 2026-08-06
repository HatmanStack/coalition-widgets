# Phase 3: suppression and reconciliation

## Phase goal

Add the two checks the whole project exists for, and bring the remaining two cadence files
through. Check 6 is the reason no small cell reaches a public CDN. Check 7 is the reason four
denominators cannot be presented as one population. At the end of this phase all nine checks are
live and all five cadence files publish.

Success criteria: `weekly.json` and `monthly.json` run end to end; the referrals series carries
three withheld points and still reconciles exactly; twenty-one hostile fixtures each fail on their
named check with no payload produced.

Estimated tokens: `~90000`

## Prerequisites

- Phases 1 and 2 complete. Checks 1, 2, 3, 4, 5, 8 and 9 are live and the registry covers live,
  quarterly and annual.
- Read [Phase-0.md](Phase-0.md) ADRs 1, 7, 8, 9 and 17. They are the five decisions this phase
  implements and each one is contestable, so read the reasoning rather than the rule. ADR 17 adds
  a rule to check 6 that the brainstorm does not state: a `residual.value` in 1 to 4 fails.
- Read `docs/PLAN.md` section 4.5 in full, including "Two things to resolve before this
  publishes". It is the specification for the Community Queue, not a discussion of it.
- Read `docs/FINDINGS.md` section 1 and `site/dashboard.html`'s `suppress()` function
  (around line 402). The JavaScript is prior art for the semantics, not for the code.

## Tasks

> **Task 1: Register the weekly and monthly entries**
>
> **Goal:** Complete the registry. After this, every publishable figure in the project is
> declared in one file and everything else is unpublishable by omission.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/contract.py`, `widgets/tests/gate/test_contract.py`
> * Content: `chronicallyHomelessOnCq`, `unaccompaniedYouthOnCq`, `veteransOnCq`,
>   `totalOlderAdultsAndSeniorsOnCq`, `averageDaysOnCq`, breakdown `olderAdultsOnCq`, and series
>   `cqReferrals`
> * Out of scope: any Community Queue measure not listed. `parentingYouthHouseholds`,
>   `cqHouseholds` and `clientsOnCqMultipleTimes` are already in the exclusion set and stay there
>
> **Constraints:**
>
> * `cqReferrals` declares `reconciles = True`, so `total` is required and the sum must be exact
> * `olderAdultsOnCq` declares `universeMeasure = "totalOlderAdultsAndSeniorsOnCq"`
> * `averageDaysOnCq` declares `kind = "average"`, so `MIN_CELL` and reconciliation do not apply
>   to it. An average is not a cell
> * No Community Queue measure declares any segment. The queue publishes its size, not its shape
> * Every weekly entry declares `cadence = "weekly"` and the referrals series declares
>   `cadence = "monthly"`, so a measure landing in the wrong file fails check 2
>
> **Acceptance Criteria:**
>
> * [ ] A test asserts the registry now covers all five cadences and that each id appears in
>       exactly one
> * [ ] A test asserts no Community Queue id declares a non-empty `segments` tuple
> * [ ] A test asserts `cqReferrals.reconciles is True` and `pitCount.reconciles is False`
> * [ ] The three excluded Community Queue ids are still absent from the registry
>
> **Commit Message Template:**
>
> ```text
> feat(contract): register the weekly and monthly Community Queue entries
>
> - Segments are weekly, referrals are monthly, the live file stays the total alone
> - averageDaysOnCq is kind average, so it is not a cell and does not reconcile
> - The three excluded CQ measures remain unregistered and unpublishable
> ```

> **Task 2: Implement check 6, the categories branch**
>
> **Goal:** No named cell below `MIN_CELL` reaches a payload, the residual that hides them is
> emitted, and the residual does not itself disclose what it hides.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/checks.py`,
>   `widgets/tests/gate/test_check_6_suppression.py`,
>   `widgets/fixtures/hostile/06-suppression-named-small-cell.json`,
>   `widgets/fixtures/hostile/14-suppressed-residual-discloses.json`
> * Patterns: Phase-0 ADR 1 (the gate validates, it does not repair) and ADR 7 (the residual must
>   not itself disclose)
> * Out of scope: folding categories. Nothing in this slice transforms a payload
>
> **Constraints:**
>
> * The check fails on: a named category value in 1 to 4; a measure value in 1 to 4 where the
>   registry `kind` is `count`; a `residual.value` in 1 to 4; a missing `suppressed` block on a
>   breakdown; `suppressed.count` greater than 0 with `suppressed.value` of 0, or the reverse;
>   `suppressed.count == 1`; `0 < suppressed.value < MIN_CELL`
> * The `residual` rule is ADR 17's second consequence. A residual is unnamed but it is still a
>   published count, and a residual of 3 is a small cell whatever it is called. `residual` carries
>   no `count`, so the ADR 7 count rule has nothing to apply to there and only the value rule does
> * A value of 0 is allowed. A true zero is not a small cell and publishing it is standard
>   practice. State that in the module docstring so a later reader does not "fix" it
> * `kind` of `percent`, `average` or `currency` is not subject to `MIN_CELL`. A 45% rate is not a
>   cell count
> * The check does not repair. It reports, and `gate()` rejects
>
> **Acceptance Criteria:**
>
> * [ ] `06-suppression-named-small-cell.json` fires exactly {check 6, check 7}, or the measured
>       set is recorded with its reason
> * [ ] `14-suppressed-residual-discloses.json` fires exactly {check 6}
> * [ ] Unit tests cover the boundary at 0, 1, 4, 5 and 6 for a category value
> * [ ] A unit test asserts `suppressed: {count: 1, value: 12}` fires and
>       `{count: 2, value: 12}` does not, which is the ADR 7 rule stated as behaviour
> * [ ] A unit test asserts `suppressed: {count: 3, value: 4}` fires, which is a residual below
>       `MIN_CELL`
> * [ ] A unit test asserts `residual: {"label": "All other", "value": 3}` fires and the same
>       residual at 99 does not
> * [ ] A unit test asserts a 45 percent value does not fire, proving `kind` gates the rule
>
> **Commit Message Template:**
>
> ```text
> feat(gate): check 6, suppression on categories
>
> - A named cell in 1 to 4 fails; zero is allowed and is not a small cell
> - A residual.value in 1 to 4 fails: unnamed is still published, per ADR 17
> - A suppressed block of one category publishes that category exactly, so count == 1 fails
> - A suppressed value below MIN_CELL is itself a small cell, so it fails
> ```

> **Task 3: Implement check 6, the series branch**
>
> **Goal:** Suppression on a time axis. Months are not foldable into "other months", so a
> sub-threshold point is withheld and labelled, with the residual in the series metadata. This is
> decision 11a and it is a distinct branch, not an edge case to improvise.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/checks.py`,
>   `widgets/tests/gate/test_check_6_suppression.py`,
>   `widgets/fixtures/hostile/13-series-small-point-folded.json`,
>   `widgets/fixtures/hostile/19-withheld-point-carries-value.json`
> * Patterns: Phase-0 ADR 8, `docs/PLAN.md` 4.5 "Two things to resolve before this publishes"
> * Out of scope: deciding whether `MIN_CELL` should apply to an event count at all.
>   `docs/PLAN.md` 4.5 records the counter-argument and takes the conservative call by default.
>   Build the conservative behaviour
>
> **Constraints:**
>
> * A point carries exactly one of `value`, `withheld: true`, or `unavailable: true`. Any other
>   combination fails, including a withheld point that also carries a `value` of any size
> * A point `value` in 1 to 4 fails
> * `withheld.count` must equal the number of withheld points, and the ADR 7 rules apply to the
>   `withheld` block as they do to `suppressed`: `count == 1` fails, `0 < value < MIN_CELL` fails
> * A series carrying a `residual`-style fold instead of withheld points fails. Note that
>   `residual` is not in the series allowlist, so check 2 fires too; the point of fixture 13 is
>   that check 6 fires on its own terms as well
> * `unavailable: true` is not a privacy state and check 6 ignores it entirely
>
> **Acceptance Criteria:**
>
> * [ ] `13-series-small-point-folded.json` fires exactly {check 2, check 6}, or the measured set
>       is recorded with its reason
> * [ ] `19-withheld-point-carries-value.json` fires exactly {check 6, check 7}, or the measured
>       set is recorded
> * [ ] A unit test asserts a withheld point with `value: 2` fires, and one with `value: 200`
>       fires as well, because the failure is the presence of the key and not the size of the
>       number
> * [ ] A unit test asserts `withheld: {count: 1, value: 3}` fires on both ADR 7 rules and reports
>       both, not one
> * [ ] A unit test asserts a point with `unavailable: true` produces no check 6 finding
>
> **Commit Message Template:**
>
> ```text
> feat(gate): check 6, the withheld-point branch for time series
>
> - Months cannot fold into an unnamed residual, so a sub-threshold point is withheld and labelled
> - A withheld point carrying a value fails whatever the value is
> - unavailable means never published and is not a privacy state; check 6 ignores it
> ```

> **Task 4: Implement check 7, exact reconciliation**
>
> **Goal:** Named plus residual plus suppressed equals the universe, with no tolerance, and the
> universe is a figure somebody published rather than a sum of the categories. This is the direct
> defence against the failure `docs/FINDINGS.md` section 1 documents.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/checks.py`,
>   `widgets/tests/gate/test_check_7_reconciliation.py`,
>   `widgets/fixtures/hostile/07-reconciliation-off-by-one.json`,
>   `widgets/fixtures/hostile/17-denominator-mismatch.json`
> * Patterns: Phase-0 ADR 9, decision 6 (exact, no tolerance)
> * Out of scope: any tolerance, any rounding, any "close enough". One off by one is a failure
>
> **Constraints:**
>
> * Four rules, each reporting separately:
>   1. breakdown: sum of category values plus `residual.value` plus `suppressed.value` equals
>      `universe`, exactly
>   1. cross-measure: a breakdown's `universe` equals the `value` of its registered
>      `universeMeasure` when that measure appears in the same payload. When it does not appear,
>      the rule does not fire and the reason is stated in the module docstring
>   1. series: for a series where the registry says `reconciles`, the sum of published point
>      values plus `withheld.value` equals `total`, exactly
>   1. point: where a point carries `components`, they sum to its `value`, exactly
> * Integer arithmetic only. No floats anywhere in this check
> * Rule 2 is what makes rule 1 non-tautological. Without it a payload can define its universe as
>   its own sum and reconcile trivially. Say so in the docstring
>
> **Acceptance Criteria:**
>
> * [ ] `07-reconciliation-off-by-one.json` fires exactly {check 7}, and the fixture is off by
>       exactly one so the test proves there is no tolerance
> * [ ] `17-denominator-mismatch.json` sets `raceEthnicity.universe` to 2905 while
>       `activelyHomeless` is 1263, and fires exactly {check 7}
> * [ ] A test asserts each of the four rules independently, including a point whose components
>       sum to one less than its value
> * [ ] A test asserts all five valid fixtures reconcile, with the sums computed in the test
>       rather than asserted from a comment
> * [ ] `rg -n 'float|round\(|abs\(' widgets/publisher/gate/checks.py` returns no matches in
>       check 7, or each match is justified in the commit body
>
> **Commit Message Template:**
>
> ```text
> feat(gate): check 7, exact reconciliation with no tolerance
>
> - Categories plus residual plus suppressed equals the universe, integer arithmetic only
> - The universe must equal its registered universe measure, which is what stops a self-defined
>   denominator reconciling trivially
> - Series totals and point components reconcile by the same rule
> ```

> **Task 5: Write the `weekly.json` and `monthly.json` fixtures**
>
> **Goal:** The Community Queue, published as its size and its slower shape. The monthly file is
> the only real payload in the project that exercises withheld points, so it is the fixture that
> proves decision 11a rather than describing it.
>
> **Scope:**
>
> * Files: `widgets/fixtures/valid/weekly.json`, `widgets/fixtures/valid/monthly.json`,
>   `widgets/fixtures/PROVENANCE.md`, `widgets/fixtures/hostile/11-parenting-youth-households.json`,
>   `widgets/fixtures/hostile/16-cq-households.json`
> * Content: Phase-0 section 9 for both files
> * Out of scope: anything from the Community Queue dashboard beyond what `docs/PLAN.md` 4.5
>   permits
>
> **Constraints:**
>
> * **Re-read `docs/reference/community-queue-overview.png` before writing the monthly fixture.**
>   Two independent readings (the planner's and the plan reviewer's) agree on all twenty bar
>   values and on the month mapping: axis labels sit on the even-numbered bars, which places bar 1
>   at December 2024 and bar 20 at July 2026. This step is now a confirmation rather than an open
>   risk, and it is not optional: a third reading costs a minute, and two agreeing readings is the
>   standard this project holds a transcription to. If what you see differs, use the image and
>   record the correction in `feedback.md`
> * The three sub-threshold months (2, 2, 3) are withheld points with no `value` key, and
>   `withheld` is `{count: 3, value: 7}`. Published points sum to 1311 and `total` is 1318.
>   Re-derive both sums rather than copying them
> * `weekly.json` carries `veteransOnCq` at 28. That is correct: the population floor in check 9
>   applies to fast measures only, and 28 is above `MIN_CELL`
> * `parentingYouthHouseholds` and `cqHouseholds` do not appear in any valid fixture. They appear
>   only as hostile fixtures 11 and 16
> * `PROVENANCE.md` gains a row per figure, with the tile or bar it was read from
>
> **Acceptance Criteria:**
>
> * [ ] Both fixtures return `Passed`
> * [ ] A test computes the published-point sum of `cqReferrals` and asserts it equals
>       `total` minus `withheld.value`, so the reconciliation is measured in the suite
> * [ ] A test asserts `cqReferrals` has exactly three withheld points and that none carries a
>       `value` key
> * [ ] `11-parenting-youth-households.json` fires exactly {check 2} and its detail names the
>       flicker reason from the exclusion table
> * [ ] `16-cq-households.json` fires exactly {check 2}
> * [ ] `test_provenance.py` passes with the new figures
>
> **Commit Message Template:**
>
> ```text
> feat(fixtures): weekly and monthly Community Queue payloads
>
> - Weekly carries the segments, monthly carries the referrals series with three withheld months
> - Published points plus the withheld residual reconcile to the total exactly
> - parentingYouthHouseholds and cqHouseholds appear only as hostile fixtures
> ```

> **Task 6: Close the gate and prove all nine checks fire**
>
> **Goal:** All nine checks registered, all five valid fixtures publishing, all twenty-one hostile
> fixtures failing on their named checks. This is the phase where the gate is done.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/checks.py`, `widgets/tests/gate/`,
>   `widgets/tests/publisher/test_app.py`
> * Content: register checks 6 and 7 in the check list, extend the end-to-end expectation table,
>   and add the test that proves the check list is complete
> * Out of scope: S3, the archive, CSV. Phase 4
>
> **Constraints:**
>
> * A test asserts the check list has exactly nine entries, in order, with the ids Phase-0 section
>   7 names. A tenth check or a missing one is a failure
> * A test asserts every check id appears in at least one hostile fixture's expected failing set,
>   so no check ships without something written to defeat it
> * `test_totality.py` picks up checks 6 and 7 by introspection and still passes
>
> **Acceptance Criteria:**
>
> * [ ] All five valid fixtures print a payload and exit 0 through `app.py`
> * [ ] All twenty-one hostile fixtures exit non-zero with no payload printed
> * [ ] A test asserts the union of expected failing sets covers all nine check ids
> * [ ] A test asserts the check list is exactly the nine ids in the documented order
> * [ ] Full suite passes offline
>
> **Commit Message Template:**
>
> ```text
> feat(gate): all nine checks live, five cadence files publishing
>
> - Check list is asserted to be exactly nine, in order
> - Every check id appears in at least one hostile fixture's expected failing set
> - Twenty-one hostile fixtures, each asserting which check fired and that no payload was produced
> ```

## Phase verification

1. Full suite passes offline.
1. All five valid fixtures run end to end and exit 0.
1. All twenty-one hostile fixtures exit non-zero with no payload.
1. Break check 7 deliberately by allowing a tolerance of one, watch
   `07-reconciliation-off-by-one.json` pass, revert, and record what the broken run reported.
1. Break check 6 deliberately by removing the withheld-point rule, watch
   `19-withheld-point-carries-value.json` pass, revert, and record what the broken run reported.
1. Confirm the small-cell property test covers all five valid fixtures now that they all exist.

The two deliberate breakages are not optional. `docs/HANDOFF.md`'s working style calls for
breaking every gate on purpose, and these are the two gates where a false pass would cost the
most.

## Integration points

The gate is complete after this phase and its signature is frozen. Phase 4 consumes
`Passed.payload` and must not modify it. Phase 5 packages the same source as a Lambda.

## Open questions this phase does not resolve

Both are recorded in `docs/PLAN.md` section 4.5 and section 8, both need someone with the
underlying data, and neither blocks this phase:

1. Community Queue clients against Community Queue households. 1,308 and 1,308 on a dashboard
   that also reports 6 parenting youth households. Neither publishes until they reconcile, which
   is why `cqHouseholds` is an exclusion and a hostile fixture rather than a measure.
1. Whether `MIN_CELL` applies to points in a time series of an undifferentiated total. The
   conservative call is taken by default and costs three points out of twenty. If someone with
   the underlying data says otherwise, the change is to the registry and the fixture, not to
   check 6.

## Known limitations at the end of this phase

- Nothing writes to S3, there is no archive, no `index.json`, no CSV and no hash skip.
- There is no SAM template, so nothing is deployable.
- The fold that turns raw categories into a suppressed payload still does not exist, per ADR 1.
