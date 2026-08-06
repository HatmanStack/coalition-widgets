# Phase 2: cardinality, types and the PII scan

## Phase goal

Bring `quarterly.json` and `annual.json` through the same path Phase 1 built, and add the three
checks that stop a changed Look from shipping something structurally wrong: a row explosion, a
formatted string or a wrong type, and anything client-shaped. These are the checks that fire when
someone edits the query rather than when someone edits the data.

Success criteria: two more cadence files run end to end from disk to stdout; seven more hostile
fixtures (03, 04, 05, 15, 18, 20, 21) each fail on their named check; the Phase 1 fixtures still
pass unchanged.

Estimated tokens: `~80000`

## Prerequisites

- Phase 1 complete: `Result`, `gate()`, checks 1, 2, 8 and 9, `contract.py`, the file source, the
  stdout sink, `app.py`, and the cross-cutting property tests.
- Read [Phase-0.md](Phase-0.md) sections 3, 7, 8 and 9, and ADRs 4, 5, 9 and 10.
- Read `docs/FINDINGS.md` in full. The quarterly fixture is the sound half of the dashboard it
  audits, and the exclusions are the other half.

## Tasks

> **Task 1: Register the quarterly and annual measures, series and breakdowns**
>
> **Goal:** Extend the registry so the two new cadence files have something to be checked against.
> The registry is where "which segments does this measure actually have" stops being a per-widget
> accident, per decision 12.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/contract.py`, `widgets/tests/gate/test_contract.py`
> * Content: every id listed under `quarterly.json` and `annual.json` in Phase-0 section 9, with
>   `section`, `cadence`, `kind`, `precision`, `segments`, `span`, `universeMeasure`,
>   `reconciles` and `components` filled in
> * Out of scope: the weekly and monthly entries. Phase 3 adds those
>
> **Constraints:**
>
> * Segments are sparse and the registry records the truth: `inflow` and `outflow` carry
>   `("veterans",)`, `pitCount` carries `()`, and nothing carries a segment it does not have
> * `pitCount` declares `components = ("sheltered", "unsheltered")` and `reconciles = False`
>   (there is no meaningful total across years). `newlyHomelessHouseholds` and
>   `disablingConditionAtIntake` declare no components
> * `raceEthnicity` and `shelterStatus` both declare `universeMeasure = "activelyHomeless"`.
>   `aliceThreshold` declares `universeMeasure = "aliceHouseholdsBelowThreshold"`
> * Nothing from the ADR 9 and ADR 10 exclusion list is registered: no ALICE owner or renter cost
>   burden, no age distribution, no HUD CoC funding, no inflow or outflow net
> * `span` is recorded for every series now, because a span invented later is a span nobody can
>   source
>
> **Acceptance Criteria:**
>
> * [ ] A test asserts every registered breakdown has a `universeMeasure` that is itself a
>       registered measure in the same cadence
> * [ ] A test asserts `inflow.segments == ("veterans",)` and `outflow.segments == ("veterans",)`,
>       and that no series or breakdown entry carries a `segments` field at all. Asserting
>       `pitCount.segments == ()` would assert something structurally guaranteed; the meaningful
>       assertion is that the field is scoped to measures and that the allowlist rejects a
>       `segments` key on a series, which hostile fixture 21 covers
> * [ ] A test asserts no registered id is in the exclusion set, and that the ADR 9 and ADR 10
>       exclusions (owner and renter cost burden, age distribution, HUD CoC funding, net figures)
>       appear in neither the registry nor a fixture
> * [ ] Every registry entry still has `precision == "exact"`
>
> **Commit Message Template:**
>
> ```text
> feat(contract): register the quarterly and annual measures
>
> - Segments are sparse and recorded per measure, so a segment cannot be silently invented
> - Breakdowns bind to an independently published universe measure
> - ALICE cost burden, the age distribution and HUD CoC funding stay unregistered, with reasons
> ```

> **Task 2: Implement check 3, cardinality**
>
> **Goal:** A ceiling on every count in a payload. An aggregate Look returning thousands of rows
> means the Look was changed to return client-level data, and this is the cheapest place that
> becomes visible.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/checks.py`,
>   `widgets/tests/gate/test_check_3_cardinality.py`,
>   `widgets/fixtures/hostile/03-cardinality-row-explosion.json`
> * Patterns: Phase-0 section 3 constants for the ceilings, Phase-0 ADR 3 for totality
> * Out of scope: any per-measure ceiling. The ceilings are global and live in `contract.py`
>
> **Constraints:**
>
> * Ceilings come from `contract.py`, not from literals in `checks.py`
> * The check counts measures, series, breakdowns, categories per breakdown, points per series,
>   segments per measure, and total leaves, and reports each overage separately with its path
> * Total for the biggest real payload (`annual.json`) must sit comfortably below every ceiling.
>   If it does not, the ceiling is wrong and the plan is wrong; say so rather than raising the
>   ceiling to fit
>
> **Acceptance Criteria:**
>
> * [ ] `03-cardinality-row-explosion.json` fires exactly {check 3}
> * [ ] A test asserts each ceiling independently by building a payload one over it, and asserts
>       the payload one under it does not fire
> * [ ] A test records the actual counts for `annual.json` against each ceiling, so the headroom
>       is a measured number in the suite rather than a claim in a comment
>
> **Commit Message Template:**
>
> ```text
> feat(gate): check 3, cardinality ceilings
>
> - Ceilings live in contract.py and cover rows, categories, points, segments and total leaves
> - Each overage reports its own path rather than one summary failure
> - Headroom against the largest real payload is asserted, not assumed
> ```

> **Task 3: Implement check 4, type and domain**
>
> **Goal:** Every leaf value is the kind of thing the contract says it is. This is where
> `apply_formatting` leaking `"1,263"` dies, and where a boolean stops being an integer.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/checks.py`,
>   `widgets/tests/gate/test_check_4_type_and_domain.py`,
>   `widgets/fixtures/hostile/04-type-formatted-string.json`,
>   `widgets/fixtures/hostile/18-precision-rounded.json`,
>   `widgets/fixtures/hostile/20-bool-as-count.json`
> * Patterns: Phase-0 section 7 row 4, ADR 4 for the boundary against check 1, ADR 5 for `bool`
> * Out of scope: reconciliation arithmetic (check 7) and small-cell rules (check 6)
>
> **Constraints:**
>
> * Domain rules are selected by the registry's `kind`: `count` is a non-negative `int`,
>   `percent` is an `int` from 0 to 100, `average` is a non-negative `int`, `currency` is a
>   non-negative `int` of whole dollars
> * `bool` is never a valid integer here. `isinstance(True, int)` is `True` in Python, so the
>   exclusion is explicit
> * A string in a count position always fails, whatever it contains. `"1263"` is as wrong as
>   `"1,263"`
> * `precision` must equal the value the registry declares for that id, which is `exact` for every
>   entry. A payload declaring `rounded5` fails even though the enum contains it
> * An object's own `cadence` field must be one of the five names and must equal `meta.cadence`.
>   Check 4 never consults the registry: whether that id belongs in this file is check 2's
>   question, and keeping the two apart is what makes the Phase 1 hostile fixtures' expected sets
>   survive this phase. Phase-0 section 7 "Which check owns the cadence rule" is the split
> * `asOf` and `generated` are validated by shape. Use `datetime.date.fromisoformat` and
>   `datetime.datetime.fromisoformat` if that is the clearest route, and note that importing
>   `datetime` for parsing is forbidden under `gate/` by Phase-0 ADR and `test_purity.py`, so this
>   must be a string-shape check. State the chosen approach in the module docstring
> * No comparison of any date against the current time anywhere. That is a clock read
>
> **Acceptance Criteria:**
>
> * [ ] `04-type-formatted-string.json` fires exactly {check 4}
> * [ ] `18-precision-rounded.json` fires exactly {check 4}
> * [ ] `20-bool-as-count.json` fires exactly {check 4}, and a unit test asserts
>       `{"value": true}` is rejected while `{"value": 1}` is not
> * [ ] A test covers each `kind` at its boundaries: percent at -1, 0, 100, 101; count at -1 and 0
> * [ ] `test_purity.py` still passes, which means check 4 validates dates without importing
>       `datetime`
>
> **Commit Message Template:**
>
> ```text
> feat(gate): check 4, type and domain
>
> - Domain rules are selected by the registry kind: count, percent, average, currency
> - bool is explicitly not an int, because isinstance(True, int) is True
> - precision must match the registered value, so a rounding switch cannot present as exact
> ```

> **Task 4: Implement check 5, the PII scan**
>
> **Goal:** Defence in depth behind the allowlist. Check 2 rejects unknown keys; check 5 rejects
> anything client-shaped wherever it appears, including inside a value that passed the allowlist.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/checks.py`,
>   `widgets/tests/gate/test_check_5_pii_scan.py`,
>   `widgets/fixtures/hostile/05-pii-email-in-label.json`
> * Patterns: `docs/PLAN.md` section 4 row 5, `docs/HANDOFF.md` privacy section
> * Out of scope: rejecting an id because it is excluded (check 2's job)
>
> **Constraints:**
>
> * Key-name patterns: anything ending in `id` or `Id`, and anything containing `client`, `ssn`,
>   `dob`, `birth`, `email`, `phone`, `address`, `firstName`, `lastName`, `name`
> * Value patterns: email-shaped, phone-shaped, SSN-shaped, UUID-shaped, and date-of-birth-shaped
>   (a full `YYYY-MM-DD` in a label position). A series label of `2025-02` is a month and must not
>   be flagged, so the date rule distinguishes year-month from year-month-day
> * Free-text detection is a label longer than `MAX_LABEL_CHARS`, or a label outside the permitted
>   character class. `meta.source`, `meta.attribution` and `meta.disclaimer` are prose by contract
>   and are exempt from the length rule but not from the email, phone, SSN and UUID rules
> * The patterns live in `contract.py` as data, so the scan is a function over a table
>
> **Acceptance Criteria:**
>
> * [ ] `05-pii-email-in-label.json` fires exactly {check 5}
> * [ ] A test asserts a series label of `2025-02` does not fire, and a label of `1985-03-12` does
> * [ ] A test discovered from `fixtures/valid/*.json` asserts every valid fixture on disk produces
>       zero check 5 findings, including `meta.disclaimer` prose. Discovery, not a count: three
>       fixtures exist at the end of this phase and Phase 3 adds two more, and the test should
>       inherit them the way Phase 1 Task 8's small-cell test does
> * [ ] A test asserts a key named `clientId` fires check 5 independently of check 2, by calling
>       check 5 directly
>
> **Commit Message Template:**
>
> ```text
> feat(gate): check 5, the PII scan
>
> - Scans key names and string values, not only keys, so the allowlist is not the only control
> - Year-month labels are not dates of birth; year-month-day in a label position is
> - Patterns live in contract.py as data
> ```

> **Task 5: Write the `quarterly.json` and `annual.json` valid fixtures**
>
> **Goal:** Two more real payloads. The quarterly file is the sound half of the audited dashboard;
> the annual file is the Coalition's own reporting, and it is the largest payload the system will
> carry.
>
> **Scope:**
>
> * Files: `widgets/fixtures/valid/quarterly.json`, `widgets/fixtures/valid/annual.json`,
>   `widgets/fixtures/PROVENANCE.md`, `widgets/fixtures/hostile/15-segment-not-registered.json`,
>   `widgets/fixtures/hostile/21-series-carrying-segments.json`
> * Content: exactly what Phase-0 section 9 lists for each file, plus the keys the structural
>   allowlist requires and section 9 does not spell out for every object, and nothing else.
>   Section 9 now states `minCell` and `suppressed` on all three breakdowns, so the gap that
>   phrase covers should be small; if a required key is missing from section 9, add it there in
>   the same commit rather than only in the fixture
> * Out of scope: the weekly and monthly fixtures
>
> **Constraints:**
>
> * Every figure comes from `docs/HANDOFF.md` "The real data" or `docs/FINDINGS.md`. Re-read those
>   sections rather than trusting Phase-0's transcription, and re-do the arithmetic
> * The four sums to verify by hand: 679 + 343 + 142 + 99, 720 + 322 + 108 + 113,
>   27445 + 52779, and each Point-in-Time point's components against its total
> * `raceEthnicity`'s residual is an unnamed remainder of truncated labels, not a `MIN_CELL`
>   suppression. `suppressed` is `{count: 0, value: 0}` and that is correct, not a placeholder
> * Point-in-Time 2023 is `{"label": "2023", "unavailable": true}` with no `value`. It is not
>   `withheld`. The two mean different things and conflating them breaks the honesty constraint
> * `shelterStatus` publishes despite the `docs/FINDINGS.md:68` label finding. **Read ADR 17
>   before writing it.** The residual of 113 is the fourth labeled slice (33) plus the two
>   categories the audit cannot name (80). `PROVENANCE.md` records that decomposition, cites
>   `docs/FINDINGS.md` for it, and also records the unresolved half of ADR 17: whether a label is
>   attached to the wrong slice is not settled, and a named category is among the things that
>   could change if it ever is. Both the meaning and the residual risk go next to the figures
> * `PROVENANCE.md` gains a row for every new figure, with its source
> * `15-segment-not-registered.json` gives the registered measure `inflow` a `chronic` segment.
>   The registry declares `("veterans",)` for it, so the segment name is unregistered and check 2
>   fires on the registry rather than on the structural allowlist. This is the decision 12 case:
>   a measure asked for a segment it does not carry
> * `21-series-carrying-segments.json` gives the series `pitCount` a `segments` key at all, which
>   the structural allowlist does not permit on a series at any value. Both fixtures are needed:
>   `15` tests the registry, `21` tests the allowlist, and a single fixture combining them would
>   test the allowlist twice and decision 12 not at all
>
> **Acceptance Criteria:**
>
> * [ ] Both fixtures return `Passed`
> * [ ] `test_provenance.py` passes with the new figures, which means every one is sourced
> * [ ] `test_no_small_cell_reaches_the_payload.py` picks up both new fixtures automatically and
>       passes
> * [ ] `15-segment-not-registered.json` fires exactly {check 2}, and a unit test asserts the
>       failure detail names the unregistered segment `chronic` and the registered set
>       `("veterans",)`, so the test proves the registry was consulted rather than the allowlist
> * [ ] `21-series-carrying-segments.json` fires exactly {check 2}
> * [ ] A test asserts `pitCount` has a point with `unavailable: true` and no point with
>       `withheld`, so the distinction is pinned by a test rather than by care
> * [ ] A test asserts every breakdown in both fixtures carries a `suppressed` block, since the
>       allowlist makes it required and a missing one would fail check 1 or check 2
>
> **Commit Message Template:**
>
> ```text
> feat(fixtures): quarterly and annual payloads from published figures
>
> - Quarterly is the sound half of the audited dashboard; both breakdowns reconcile to 1263
> - shelterStatus publishes per ADR 17: every disputed slice sits inside the unnamed residual
> - Annual carries PIT with 2023 unavailable, not withheld: never published is not suppressed
> - PROVENANCE.md sources every new figure; arithmetic re-verified rather than inherited
> ```

> **Task 6: Run the two new cadence files end to end and close the phase**
>
> **Goal:** Prove the new checks and fixtures work through the real path, not only in unit tests.
>
> **Scope:**
>
> * Files: `widgets/tests/publisher/test_app.py`
> * Content: extend the end-to-end test to cover every valid fixture on disk and every hostile
>   fixture on disk, discovered from the directories
> * Out of scope: S3, the archive, CSV
>
> **Constraints:**
>
> * Discovery from disk, not a hand-maintained list, so Phase 3 inherits the coverage
> * Each hostile fixture's expected failing set lives in one table in the test module, keyed by
>   filename, and a test asserts the table covers every file in `fixtures/hostile/`. A new hostile
>   fixture with no expectation is a failure, not a silent gap
>
> **Acceptance Criteria:**
>
> * [ ] `python3 publisher/app.py fixtures/valid/quarterly.json` and the same for `annual.json`
>       both print a payload and exit 0
> * [ ] Every hostile fixture on disk exits non-zero with no payload printed
> * [ ] The expectation table covers `fixtures/hostile/*.json` exactly, asserted by set comparison
> * [ ] Full suite passes offline
>
> **Commit Message Template:**
>
> ```text
> test(publisher): end-to-end coverage discovered from the fixture directories
>
> - Every valid fixture publishes, every hostile fixture does not
> - Expected failing sets are a table asserted to cover every hostile file on disk
> ```

## Phase verification

1. Full suite passes offline.
1. All three of `live.json`, `quarterly.json` and `annual.json` run end to end and exit 0.
1. All thirteen hostile fixtures that exist at this point exit non-zero with no payload
   (01, 02, 03, 04, 05, 08, 09, 10, 12, 15, 18, 20, 21).
1. Break check 4 deliberately (remove the `bool` exclusion) and watch `20-bool-as-count.json`
   pass, then revert. Record what the broken run reported. A type check that cannot be broken on
   purpose is a type check nobody has tested.
1. `rg -n 'import (os|time|datetime|random|boto3|urllib|pathlib)' widgets/publisher/gate/`
   returns no matches.

## Integration points

Checks 3, 4 and 5 join the list in `checks.py`. Their addition must not change the failing set of
any Phase 1 hostile fixture, and if it does, the change is recorded rather than papered over.

The one collision that would otherwise cause that is check 4's cadence-field rule against
check 2's registry-cadence rule, and it is pinned rather than left to chance: the Phase 1 hostile
fixtures write an injected id's own `cadence` field as the file's cadence, so check 4 does not
fire on them and `08`, `10` and `12` all keep check 2 and check 8. Verify that rather than assume
it, since it is the predictable failure of this phase.

Two Phase 1 sets do change, both by gaining check 5, and both are recorded rather than papered
over. `02` widens from {2} to {2, 5}, which is what Phase-0 section 8 always said it would be.
`12` widens from {2, 8} to {2, 5, 8}, which section 8 did not anticipate: `clientsOnCqMultipleTimes`
contains `client`, so the scan fires on the id itself. Section 8's table is edited to match rather
than the fixture or the check. Do not add an exemption for ids the registry or the exclusion set
names; one was tried and removed, because for a **registered** id check 2 does not fire at all and
the key scan is then the only control on that name.

`contract.py` grows registry entries; its structure does not change.

## Known limitations at the end of this phase

- Checks 6 and 7 are still unimplemented, so nothing enforces suppression or reconciliation. The
  quarterly fixture reconciles by construction and no test proves it yet.
- Nothing writes to S3 and there is still no template.
- `weekly.json` and `monthly.json` do not exist, so the Community Queue segments and the referrals
  series are unpublished.
