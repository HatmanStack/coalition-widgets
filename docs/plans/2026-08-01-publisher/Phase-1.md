# Phase 1: walking skeleton, `live.json` end to end

## Phase goal

Build the thinnest complete path through the publisher: a fixture on disk, through a pure gate
that enforces the four checks which make the fast measure safe, out to stdout. When this phase is
done the Community Queue total can be published by hand and nothing about it can go wrong
silently.

Success criteria: `python3 publisher/app.py fixtures/valid/live.json` prints a valid payload;
the same command against each of six hostile fixtures prints no payload and names which check
fired; the whole suite passes offline.

Estimated tokens: `~65000`

## Prerequisites

- Read [Phase-0.md](Phase-0.md) in full. It is the contract, the conventions and the ADRs.
- Read `docs/PLAN.md` sections 3.2, 3.3, 4 and 4.5, and `docs/HANDOFF.md`'s privacy constraints
  and working style.
- `uv` on PATH. No AWS credentials, no Docker, no network needed for this phase.

## Tasks

> **Task 1: Create the `widgets/` skeleton and a test harness that runs**
>
> **Goal:** Establish the layout every later phase writes into, and prove the test command works
> before there is anything to test. The import path has to be right from the start because the
> Lambda and the test suite must import the same names.
>
> **Scope:**
>
> * Files to create: `widgets/pytest.ini`, `widgets/publisher/gate/__init__.py`,
>   `widgets/publisher/gate/contract.py`, `widgets/publisher/gate/checks.py`,
>   `widgets/publisher/gate/walk.py`, and the `widgets/fixtures/` and `widgets/tests/` trees
> * Patterns to follow: the layout table in Phase-0 section 2. `publisher/` is a source root, not
>   a package, so there is no `__init__.py` above `gate/`
> * Out of scope: `requirements.txt`, `pyproject.toml`, any dependency file, and anything under
>   `widgets/embed/`
>
> **Constraints:**
>
> * `pytest.ini` sets `pythonpath = publisher` and `testpaths = tests` so tests import
>   `from gate import gate`, the same name `app.py` will use inside the Lambda
> * No runtime dependency is added anywhere, now or later
> * `.gitignore` already covers `.aws-sam/` and `widgets/embed/dist/`; do not edit it
>
> **Acceptance Criteria:**
>
> * [ ] `cd widgets && uv run --with pytest --no-project pytest -q` exits 0 and collects at least
>       one test
> * [ ] A test importing `from gate import contract` passes, proving the `pythonpath` setting
>       works rather than assuming it
> * [ ] `rg -n 'requirements|pyproject' widgets/` returns no matches
>
> **Commit Message Template:**
>
> ```text
> chore(publisher): add widgets skeleton and pytest harness
>
> - publisher/ is the Lambda CodeUri and the pytest source root
> - pythonpath = publisher so tests and the handler import the same names
> - No dependency file: boto3 comes from the runtime, everything else is stdlib
> ```

> **Task 2: Write `contract.py`, the field allowlist, exclusions, constants and the live registry entry**
>
> **Goal:** Put every fact the gate reasons from in one declarative module, so a check is a
> function over data rather than a pile of literals. This is the file a reviewer reads to answer
> "what is publishable".
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/contract.py`, `widgets/tests/gate/test_contract.py`
> * Content: the structural field allowlist table, the constants block, the eight excluded ids
>   with their reasons, and the registry entry for `queueTotal` only
> * Patterns: Phase-0 section 3 for the exact allowlist, section 3 constants block, and the
>   exclusion table with its `docs/FINDINGS.md` and `docs/PLAN.md` 4.5 citations
> * Out of scope: registry entries for any cadence other than `live`. Later phases add theirs.
>
> **Constraints:**
>
> * Pure data and pure functions only. The banned import list is the eleven names in Phase-0
>   section 5 and Task 8 of this phase, and it applies to every module under `gate/`
> * Every excluded id carries its reason as data, not as a comment, so check 2 can put the reason
>   in `Failure.detail`
> * `precision` is `exact` for every registered entry. `rounded5` exists in the enum and no entry
>   may use it, per decision 9b
> * Registry entries are immutable (frozen dataclass or a mapping of frozen dataclasses)
>
> **Acceptance Criteria:**
>
> * [ ] The exclusion set has exactly eight ids and each carries a non-empty reason string
> * [ ] No id appears in both the registry and the exclusion set; a test asserts the sets are
>       disjoint
> * [ ] `queueTotal` is registered with `cadence="live"`, `kind="count"`, `segments=()`,
>       `precision="exact"`
> * [ ] A test asserts every registry entry has `precision == "exact"`
> * [ ] `rg -n '^import |^from ' widgets/publisher/gate/contract.py` shows only stdlib typing and
>       dataclass imports
>
> **Commit Message Template:**
>
> ```text
> feat(contract): field allowlist, exclusions and the live registry entry
>
> - Eight excluded ids, each with the reason it is unpublishable
> - Registry records cadence, kind, precision, segments and universe binding
> - queueTotal is the only live measure and declares no segments
> ```

> **Task 3: Write the `Result` type and the `gate()` entry point**
>
> **Goal:** Make a partial pass unrepresentable before any check exists, so no later phase can
> introduce one. This is decision 7 expressed as a type rather than a convention.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/__init__.py`, `widgets/tests/gate/test_result_type.py`
> * Content: `Failure`, `Passed`, `Rejected`, the `Result` union, a `CheckId` enumeration with
>   stable string values, and `gate(payload) -> Result` running whatever check list `checks.py`
>   exposes
> * Patterns: Phase-0 ADR 2 for the exact shape, ADR 3 for the run-all-nine behaviour
> * Out of scope: the checks themselves
>
> **Constraints:**
>
> * `Passed` has no `failures` attribute and `Rejected` has no `payload` attribute. Not a
>   property that raises, not `None`: the attribute does not exist
> * `Rejected` with an empty `failures` tuple raises in `__post_init__`
> * `gate()` runs every registered check unconditionally and concatenates their findings, so a
>   payload failing three checks reports three
> * `gate()` catches nothing
> * `Rejected.failures` is ordered by check number then by path, deterministically
>
> **Acceptance Criteria:**
>
> * [ ] `getattr(Passed(payload), "failures", None)` is `None` and
>       `getattr(Rejected(fs), "payload", None)` is `None`, asserted by test
> * [ ] `Rejected(())` raises, asserted by test
> * [ ] A test builds a fake check list of three always-failing checks and asserts all three
>       failures are reported, in check order
> * [ ] `gate()` on a payload with zero findings returns `Passed` whose `payload` is the identical
>       object passed in (identity, not equality)
>
> **Commit Message Template:**
>
> ```text
> feat(gate): Result type where a partial pass cannot be expressed
>
> - Passed carries the payload, Rejected carries failures, neither has the other's field
> - Rejected with no failures raises rather than representing a silent pass
> - gate() runs every check and collects, so three failures report three
> ```

> **Task 4: Implement checks 1, 2, 8 and 9**
>
> **Goal:** The four checks that make `live.json` safe. Check 1 catches a Looker error object
> returned with HTTP 200, check 2 is the allowlist, check 8 keeps the fast file to one measure,
> and check 9 keeps a small population off it.
>
> **Scope:**
>
> * Files: `widgets/publisher/gate/checks.py`, `widgets/publisher/gate/walk.py`,
>   `widgets/tests/gate/test_check_1_payload_shape.py`,
>   `widgets/tests/gate/test_check_2_field_allowlist.py`,
>   `widgets/tests/gate/test_check_8_single_fast_measure.py`,
>   `widgets/tests/gate/test_check_9_population_floor.py`
> * Patterns: Phase-0 section 7 for what each check fails on, ADR 3 for totality, ADR 4 for the
>   check 1 and check 4 split, ADR 6 for why `meta.cadence` exists
> * Out of scope: checks 3, 4, 5, 6, 7. Their functions may be stubs returning an empty list, but
>   a stub must be obviously a stub and must not be registered in the check list until its phase.
>   Task 8's totality test introspects the **registered** check list, not the module, so a stub
>   cannot pass it trivially and report coverage it does not have
>
> **Constraints:**
>
> * Every check is a pure function taking the payload and the contract and returning a list of
>   `Failure`. No I/O, no clock, no environment, no randomness
> * Every check is total: it returns findings for any JSON-representable input and raises nothing,
>   including `None`, `[]`, `""`, and dicts whose values are the wrong types
> * Check 2 covers four distinct things and each produces a distinguishable `detail`: an unknown
>   structural key, an unregistered id, an explicitly excluded id (with its reason), and an id
>   whose registry cadence disagrees with `meta.cadence`
> * Check 8 fails when a live payload holds more than one entry across all three sections, holds
>   an entry that is not the registered live measure, or gives the live measure a `segments` key
> * Check 9 applies only when `meta.cadence == "live"`
> * `walk.py` is shared traversal only. It contains no policy
>
> **Acceptance Criteria:**
>
> * [ ] `check_1_payload_shape({"error": "...", "message": "..."})` returns at least one failure
>       naming the unknown top-level key
> * [ ] Each of the four checks, called with `None`, `[]`, `""`, `0`, `{"meta": None}` and
>       `{"measures": []}`, returns a list and raises nothing
> * [ ] A live payload with two measures fires check 8; the same payload with one fires none of 8
> * [ ] A live payload whose measure carries `segments` fires check 8
> * [ ] A live payload whose measure value is 28 fires check 9; at 100 it does not; at 99 it does
> * [ ] Every `Failure.detail` from these four checks states the received value, not only the
>       expectation, asserted by at least one test per check
>
> **Commit Message Template:**
>
> ```text
> feat(gate): checks 1, 2, 8 and 9
>
> - Shape check catches an error object returned with HTTP 200 without knowing Looker exists
> - Allowlist distinguishes unknown key, unregistered id, excluded id and wrong cadence file
> - live.json holds exactly one measure, with no segments, over a population of at least 100
> - Every check is total: hostile input produces findings, never an exception
> ```

> **Task 5: Write the `live.json` valid fixture and `PROVENANCE.md`**
>
> **Goal:** The first real payload, and the document that makes decision 10 checkable. Every
> figure in a valid fixture has to be traceable to published Coalition material.
>
> **Scope:**
>
> * Files: `widgets/fixtures/valid/live.json`, `widgets/fixtures/PROVENANCE.md`,
>   `widgets/tests/gate/test_valid_fixtures.py`, `widgets/tests/gate/test_provenance.py`
> * Content: `queueTotal` 1308 and its `meta`, per Phase-0 section 9. `PROVENANCE.md` is a table
>   of figure, id, and source, where source names the file and the line or the tile in
>   `docs/reference/community-queue-overview.png`
> * Out of scope: the other four valid fixtures
>
> **Constraints:**
>
> * Nothing in a valid fixture may be modelled, estimated or invented. 1308 is read off the
>   Community Queue Overview tile
> * `meta.generated` in a fixture is a fixed timestamp, not the current time, so the fixture is
>   deterministic
> * `meta.disclaimer` carries the unaffiliated-concept text and does not come off, per
>   `docs/HANDOFF.md`
> * `test_provenance.py` parses `PROVENANCE.md` and asserts membership. It must fail if a figure
>   is added to a fixture without being sourced. Prove that by adding a bogus figure locally,
>   watching the test fail, and reverting
>
> **Acceptance Criteria:**
>
> * [ ] `gate(json.load(live.json))` returns `Passed`
> * [ ] `test_provenance.py` passes, and its failure mode was demonstrated rather than assumed:
>       the commit body records what the deliberately-broken run reported
> * [ ] Every count position in `live.json` appears in `PROVENANCE.md`
> * [ ] `rg -nP '\x{2014}' widgets/fixtures/` returns no matches (no em dashes in shipped strings)
>
> **Commit Message Template:**
>
> ```text
> feat(fixtures): live.json and the provenance record
>
> - queueTotal 1308, the Community Queue total alone, no segments
> - PROVENANCE.md sources every figure to published Coalition material
> - test_provenance.py makes decision 10 executable; verified by breaking it
> ```

> **Task 6: Write the six Phase 1 hostile fixtures and their tests**
>
> **Goal:** Prove the four checks bite by attacking them. This is the verification bar for the
> whole project: not that the gate returned a failure, but which check fired and that no payload
> was produced.
>
> **Scope:**
>
> * Files: `widgets/fixtures/hostile/01-shape-looker-error.json`,
>   `02-allowlist-client-id.json`, `08-live-second-measure.json`,
>   `09-live-population-floor.json`, `10-live-segmented.json`,
>   `12-clients-on-cq-multiple-times.json`, plus `widgets/tests/gate/test_exclusions.py` and the
>   per-check test modules from Task 4
> * Patterns: Phase-0 section 8 for the expected failing set of each
> * Out of scope: the fifteen hostile fixtures belonging to later phases
>
> **Constraints:**
>
> * Every hostile fixture is obviously fabricated. Do not reuse a real figure where a made-up one
>   would do, except where the attack is specifically about a real value (fixture 09 uses
>   `queueTotal` at 28, which is the veteran count and is the point of the attack)
> * Any fixture that puts a foreign id into a cadence file writes that id's own `cadence` field as
>   the **file's** cadence, not its registry cadence. In `08` and `12` the injected id carries
>   `"cadence": "live"`. The payload is then internally consistent and the only thing it
>   contradicts is the registry, so the failure is attributable to check 2 rather than to a typo,
>   and check 4 will not fire when it arrives in Phase 2. Phase-0 section 7 "Which check owns the
>   cadence rule" is the reasoning. `10` injects no id, only an unregistered segment on the live
>   measure, whose `cadence` is `"live"` anyway
> * `08`, `10` and `12` are all built on `live.json`, so check 8 fires on all three. `08` and `10`
>   read {2, 8}. `12` carries check 8 purely because Phase 1 has no non-live base to build it on;
>   the exclusion fixtures that do not, `11` and `16`, are Phase 3 and sit on `weekly.json`.
>   `12`'s full set is {2, 5, 8}, because `clientsOnCqMultipleTimes` contains `client` and the
>   Phase 2 PII scan fires on the id itself. In Phase 1 it measures {2, 8}, since check 5 does not
>   exist yet, and the Phase 2 implementer widens it. See Phase-0 section 8's interactions list
> * Each test asserts the **exact set** of check ids that fired, not just membership, and asserts
>   the result is `Rejected` and therefore has no `payload` attribute
> * `test_exclusions.py` is parameterized over all eight excluded ids: inject each into an
>   otherwise-valid payload and assert check 2 fires with the recorded reason in the detail. This
>   is the one hostile test that asserts membership rather than an exact set, and the exception is
>   deliberate: at Phase 1 the only valid payload is `live.json`, so an injected id necessarily
>   makes the live file carry two measures and trips check 8 as well. Phase-0 section 5 records the
>   exception under "One deliberate exception to the exact-set rule". Every other hostile test in
>   this task asserts an exact set
> * Where a measured failing set differs from Phase-0 section 8, record the measured set and the
>   reason in the commit body and in `feedback.md` rather than bending the fixture to match
>
> **Acceptance Criteria:**
>
> * [ ] Six hostile fixtures exist and each has a test asserting its exact failing set
> * [ ] `02` fires exactly {check 2, check 5}, or the measured set is recorded with its reason
> * [ ] `08` and `10` each fire exactly {check 2, check 8}, or the measured set is recorded. `12`
>       fires {check 2, check 8} in this phase and {check 2, check 5, check 8} once check 5 is
>       registered in Phase 2
> * [ ] `09` fires exactly {check 9}
> * [ ] Every hostile test asserts `not hasattr(result, "payload")`
> * [ ] `test_exclusions.py` covers all eight ids, asserted by comparing the parameter list
>       against `contract.EXCLUDED` so a new exclusion cannot be added without a test
>
> **Commit Message Template:**
>
> ```text
> test(gate): six hostile fixtures for checks 1, 2, 8 and 9
>
> - Each asserts the exact set of checks that fired, not just that something failed
> - Each asserts no payload was produced
> - Exclusion test is parameterized off contract.EXCLUDED so it cannot fall behind
> ```

> **Task 7: Wire the file source, the stdout sink and the handler**
>
> **Goal:** Close the loop. A payload on disk, through the gate, printed. This is the run that
> needs no credentials and is the local default for the rest of the project.
>
> **Scope:**
>
> * Files: `widgets/publisher/sources/file.py`, `widgets/publisher/sinks/stdout.py`,
>   `widgets/publisher/app.py`, `widgets/tests/publisher/test_app.py`
> * Content: `app.py` assembles `meta` (clock and `MIN_BUNDLE` from the environment), calls the
>   gate, and on `Passed` hands the payload to the sink. On `Rejected` it writes nothing, prints
>   each failure with its check id and path, and emits the `PublishFailed` metric
> * Patterns: Phase-0 ADR 12 for the assemble-then-gate order, `docs/PLAN.md` 3.3 for the
>   source and sink factoring
> * Out of scope: `sinks/s3.py`, the archive, `index.json`, CSV, the hash skip. All Phase 4.
>   `sources/looker.py` is phase 7 of the wider design and is not built here
>
> **Constraints:**
>
> * `app.py` is the only impure module in the publisher. The clock, the environment and the
>   filesystem live here and nowhere else
> * `meta` is assembled before the gate, never after. Nothing mutates the payload after the gate,
>   and a test asserts the printed bytes deserialize to exactly `Passed.payload`
> * The `PublishFailed` metric is emitted as CloudWatch embedded metric format JSON on stdout, so
>   it needs no boto3 call and no IAM permission
> * A `Rejected` run exits non-zero and prints no payload. Not a partial payload, not a payload
>   with a warning: nothing
> * `app.py` is runnable directly (`python3 publisher/app.py <fixture path>`) as well as through
>   the Lambda `handler(event, context)` signature
>
> **Acceptance Criteria:**
>
> * [ ] `cd widgets && python3 publisher/app.py fixtures/valid/live.json` prints the payload and
>       exits 0
> * [ ] The same command against each of the six hostile fixtures exits non-zero, prints no JSON
>       payload, and prints the failing check ids
> * [ ] A test asserts the stdout payload parses back to an object equal to `Passed.payload`
> * [ ] A test asserts a `Rejected` run produced zero writes to the sink, by using a sink that
>       records calls rather than by inspecting stdout
> * [ ] `rg -n 'import os|import time|datetime' widgets/publisher/gate/` returns no matches
>
> **Commit Message Template:**
>
> ```text
> feat(publisher): file source, stdout sink and the handler
>
> - meta is assembled before the gate so everything published was checked
> - Rejected writes nothing and exits non-zero, with the failing check ids named
> - PublishFailed is emitted as EMF on stdout, needing no boto3 and no permission
> ```

> **Task 8: Add the cross-cutting property tests**
>
> **Goal:** Assert the properties that no single check owns and that would otherwise decay
> quietly: purity, totality, and that no small cell reaches a payload.
>
> **Scope:**
>
> * Files: `widgets/tests/gate/test_purity.py`, `widgets/tests/gate/test_totality.py`,
>   `widgets/tests/gate/test_no_small_cell_reaches_the_payload.py`
> * Patterns: Phase-0 section 5 for what each proves
> * Out of scope: performance tests, coverage thresholds
>
> **Constraints:**
>
> * `test_purity.py` reads the source of every module under `gate/` and asserts none imports
>   `os`, `time`, `datetime`, `random`, `secrets`, `boto3`, `urllib`, `pathlib`, `socket`,
>   `subprocess` or `pytest`. Parse with `ast`, not a regex, so a comment mentioning `os` does not
>   fail it and `import os as _o` does not slip past
> * `test_totality.py` uses a fixed, hand-written corpus of about 30 malformed inputs. No random
>   seed, so a failure reproduces from the test file alone
> * The small-cell test runs over every valid fixture that exists, discovered from the directory
>   rather than listed, so later phases inherit it without editing it
> * The small-cell test checks count positions only. `schemaVersion: 1`, `minCell: 5` and
>   `suppressed.count: 3` are not count positions and must not be flagged
>
> **Acceptance Criteria:**
>
> * [ ] `test_purity.py` fails when a forbidden import is added to a `gate/` module, demonstrated
>       and reverted, with the observed failure recorded in the commit body
> * [ ] `test_totality.py` exercises every check in the **registered check list**, discovered by
>       introspection rather than by a hand-maintained list. Unregistered stubs are not exercised
>       and are not counted as covered
> * [ ] `test_no_small_cell_reaches_the_payload.py` discovers fixtures from
>       `fixtures/valid/*.json` and passes for `live.json`
> * [ ] Full suite passes with the machine offline
>
> **Commit Message Template:**
>
> ```text
> test(gate): purity, totality and small-cell property tests
>
> - Purity is asserted by AST inspection of every gate module, not by review
> - Totality corpus is fixed and hand-written, so failures reproduce exactly
> - Small-cell test discovers fixtures from disk so later phases inherit it
> ```

## Phase verification

1. `cd widgets && uv run --with pytest --no-project pytest -q` passes with the machine offline.
1. `python3 publisher/app.py fixtures/valid/live.json` prints a payload and exits 0.
1. `python3 publisher/app.py fixtures/hostile/<each>.json` exits non-zero, prints no payload, and
   names the check that fired, for all six.
1. `rg -n 'import (os|time|datetime|random|boto3|urllib|pathlib)' widgets/publisher/gate/`
   returns no matches.
1. Deliberately break one guard, watch it fail, revert. Record what the broken run reported.
   `test_purity.py` and `test_provenance.py` both have this as an explicit acceptance criterion
   because both are the kind of check that can silently enforce nothing.

## Integration points

`gate()` is the only entry point anything outside `gate/` calls. `app.py` depends on
`sources.file`, `sinks.stdout` and `gate`, and on nothing else. Later phases add checks to the
list in `checks.py` and registry entries to `contract.py`, and must not change these signatures.

## Known limitations at the end of this phase

- Five of the nine checks are unimplemented. `live.json` is safe; nothing else is gated.
- Nothing writes to S3. There is no archive, no `index.json`, no CSV and no hash skip.
- No SAM template exists, so nothing is deployable and nothing needs to be.
- The fold that turns raw categories into a suppressed payload does not exist and is deferred to
  phase 7 of the wider design, per Phase-0 ADR 1.
