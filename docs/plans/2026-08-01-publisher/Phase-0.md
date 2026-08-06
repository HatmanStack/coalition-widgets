# Phase 0: the law

Everything every later phase inherits. Nothing here is implemented on its own. Read this before
Phase 1 and refer back to it rather than restating it.

## 1. Project conventions

### Environment

Linux (ChromeOS/Crostini). Python 3.13 managed by `uv`. Node via nvm, not used in this slice.
AWS CLI authenticated by IAM Identity Center, profile `dev`, workload region for this stack is
`us-east-1` (CloudFront and the bucket both live there; the account's usual default of
`us-west-2` does not apply to this stack).

- Python packages: `uv pip install` or `uvx`. Never `pip` directly.
- Run the test suite as `uv run --with pytest --no-project pytest` from `widgets/`.
- `cfn-lint` is not installed globally. Invoke it as `uvx cfn-lint`.
- `/usr/bin/pytest` exists at version 7.2.1 and is not the interpreter this project targets. Do
  not use it.

### Commands an agent never runs

`sam build`, `sam deploy`, `aws s3 cp`, `aws s3 sync`, `aws cloudformation deploy`, or anything
else that mutates an AWS account. Deploy is a human activity against the `dev` profile. This is
a standing rule in this environment, not a property of this plan.

`sam local invoke` and `sam validate --lint` are read-only and are required verification steps.

### Prose style

No em dashes anywhere: not in code comments, docstrings, markdown, commit messages, or error
strings. Use commas, periods, semicolons or parentheses. No filler openers, no hedge stacking,
no emoji, no exclamation marks. Direct and factual. This applies to generated JSON string values
as well, because `meta.disclaimer` ships to partner sites.

### Commit format

Conventional commits, one atomic commit per task. Scopes in use: `gate`, `contract`, `fixtures`,
`publisher`, `infra`, `docs`, `test`.

```text
feat(gate): add check 7, exact reconciliation

- Named categories plus residual plus suppressed must equal the universe with no tolerance
- Cross-measure binding: a breakdown universe must equal its registered universe measure
- Hostile fixture 07 asserts the check fires and no payload is produced
```

Run `git status` before every commit. Pre-staged items get swept into narrowly scoped commits.
Never amend. The repository is a git repo on branch `main`; the root `README.md` claim that
`git init` has not been run is stale and is not this plan's to fix.

### Files this plan must not modify

`site/`, `powerbi/`, `amplify.yml`, the root `README.md`, and everything in `docs/` outside
`docs/plans/`. `site/` is deployed and `docs/` is the established design record. All new work
lands under `widgets/`.

## 2. Layout

```text
widgets/
├── template.yaml            SAM: bucket, distribution, OAC, policies, function, schedule, alarm
├── samconfig.toml           profile dev, region us-east-1
├── pytest.ini               pythonpath = publisher, testpaths = tests
├── README.md                what this slice is, how to test it, how a human deploys it
├── publisher/               CodeUri for the function. Source root for tests.
│   ├── app.py               handler: source, gate, hash, sink, archive
│   ├── publish.py           pure publish decisions: keys, headers, hash, archive names, index, CSV
│   ├── gate/
│   │   ├── __init__.py      gate(payload) -> Result, and the Result type
│   │   ├── contract.py      field allowlist, measure registry, exclusions, ceilings, constants
│   │   ├── checks.py        one pure function per check, nine of them
│   │   └── walk.py          shared structural traversal used by checks 2, 4 and 5
│   ├── sources/
│   │   └── file.py          read a fixture from disk
│   └── sinks/
│       ├── stdout.py        print. The local default.
│       └── s3.py            the last mile only
├── fixtures/
│   ├── PROVENANCE.md        every figure in every valid fixture, and where it came from
│   ├── valid/               live, weekly, monthly, quarterly, annual
│   └── hostile/             one per check plus the concrete cases, numbered
└── tests/
    ├── gate/                one test module per check, plus the cross-cutting properties
    └── publisher/           publish decisions, sources, sinks, handler
```

`publisher/` is a source root, not a package. The Lambda handler is `app.handler` with
`CodeUri: publisher/`, so imports inside it are top level (`from gate import gate`). `pytest.ini`
sets `pythonpath = publisher` so tests import the same names the Lambda does. There is no
`pyproject.toml`, no `requirements.txt`, and no `__init__.py` above `gate/`.

## 3. The payload contract

One shape, five cadence files. Every published object is this shape.

```json
{
  "meta": {
    "schemaVersion": 1,
    "generated": "2026-08-01T14:04:00Z",
    "cadence": "quarterly",
    "source": "Coalition HMIS via Looker",
    "attribution": "Coalition to End Homelessness, Wichita and Sedgwick County",
    "disclaimer": "Unaffiliated concept work. Not produced, authorised or endorsed by United Way of the Plains or the Coalition to End Homelessness.",
    "minBundle": 1
  },
  "measures": {
    "activelyHomeless": {
      "value": 1263,
      "asOf": "2026-03-31T23:59:59Z",
      "cadence": "quarterly",
      "precision": "exact",
      "kind": "count"
    }
  },
  "series": {
    "pitCount": {
      "asOf": "2026-01-29",
      "cadence": "annual",
      "precision": "exact",
      "kind": "count",
      "points": [
        { "label": "2022", "value": 690 },
        { "label": "2023", "unavailable": true },
        { "label": "2024", "value": 691, "components": { "sheltered": 503, "unsheltered": 188 } }
      ]
    }
  },
  "breakdowns": {
    "raceEthnicity": {
      "asOf": "2026-03-31T23:59:59Z",
      "cadence": "quarterly",
      "precision": "exact",
      "kind": "count",
      "universe": 1263,
      "minCell": 5,
      "categories": [{ "label": "White", "value": 679 }],
      "residual": { "label": "All other categories", "value": 99 },
      "suppressed": { "count": 0, "value": 0 }
    }
  }
}
```

A reconcilable series carrying withheld points:

```json
{
  "cqReferrals": {
    "asOf": "2026-07-31",
    "cadence": "monthly",
    "precision": "exact",
    "kind": "count",
    "minCell": 5,
    "total": 1318,
    "points": [
      { "label": "2024-12", "value": 81 },
      { "label": "2025-02", "withheld": true }
    ],
    "withheld": { "count": 3, "value": 7 }
  }
}
```

A segmented measure. `value` is always the all-population figure; `segments` names the others:

```json
{
  "inflow": {
    "value": 3577,
    "segments": { "veterans": 197 },
    "asOf": "2025-12-31T23:59:59Z",
    "cadence": "annual",
    "precision": "exact",
    "kind": "count"
  }
}
```

### The structural field allowlist

Exhaustive. Any key not on this list at its level is a check 2 failure, not a warning.

| Level | Allowed keys | Required |
|---|---|---|
| top | `meta`, `measures`, `series`, `breakdowns` | `meta`, and at least one of the other three |
| `meta` | `schemaVersion`, `generated`, `cadence`, `source`, `attribution`, `disclaimer`, `minBundle` | all seven |
| measure | `value`, `segments`, `asOf`, `cadence`, `precision`, `kind` | `value`, `asOf`, `cadence`, `precision`, `kind` |
| series | `asOf`, `cadence`, `precision`, `kind`, `minCell`, `total`, `points`, `withheld` | `asOf`, `cadence`, `precision`, `kind`, `points` |
| point | `label`, `value`, `components`, `withheld`, `unavailable` | `label`, and exactly one of `value`, `withheld`, `unavailable` |
| breakdown | `asOf`, `cadence`, `precision`, `kind`, `universe`, `minCell`, `categories`, `residual`, `suppressed` | all but `residual` |
| category | `label`, `value` | both |
| `residual` | `label`, `value` | both |
| `suppressed`, `withheld` block | `count`, `value` | both |
| `segments` | keys are the registered segment names for that measure | n/a |
| `components` | keys are the registered component names for that series | n/a |

### The measure registry

`contract.py` holds one entry per publishable measure, series and breakdown. Fields:

| Field | Meaning |
|---|---|
| `id` | the key it appears under in a payload |
| `section` | `measures`, `series` or `breakdowns` |
| `cadence` | which of the five files it belongs in. Appearing in any other file is a failure. |
| `kind` | `count`, `percent`, `average` or `currency`. Selects the domain rules in check 4 and whether `MIN_CELL` and reconciliation apply. |
| `precision` | permanently `exact` for every entry, per decision 9b |
| `segments` | **measures only.** Tuple of segment names other than `all`. Empty tuple means the measure has no segments and a payload naming one fails. Series and breakdown entries do not carry the field, because the structural allowlist does not permit a `segments` key on a series or a breakdown at any value, so a registry declaration there could never be consulted. |
| `span` | published span, for series. Used by the widgets later; recorded now so it cannot be invented later. |
| `universeMeasure` | for breakdowns, the id of the independently published measure its `universe` must equal |
| `reconciles` | for series, whether `total` is required and the sum must be exact |
| `components` | for series, the allowed component names on a point |

### Constants

```text
MIN_CELL              = 5     any count cell below this may not be published
LIVE_POPULATION_FLOOR = 100   a fast measure's universe must be at least this
MAX_MEASURES          = 32
MAX_SERIES            = 16
MAX_BREAKDOWNS        = 16
MAX_CATEGORIES        = 24    per breakdown
MAX_POINTS            = 64    per series
MAX_SEGMENTS          = 8     per measure
MAX_LABEL_CHARS       = 64
MAX_LEAVES            = 512   total leaf values in one payload
```

### Object keys

The complete set of keys a run can write. `docs/PLAN.md` 3.2 gives the three JSON forms and 4.4
says only "CSV alongside JSON", so the two CSV forms are specified here for the first time. They
follow the same rule 4.4 gives for the archive: periods rather than timestamps, and a path a
reader can construct without reading documentation. A reader who has `quarterly.json` can guess
`quarterly.csv`, and one who has `archive/quarterly/2026-Q1.json` can guess its CSV.

| Object | Key | `Cache-Control` | `Content-Type` |
|---|---|---|---|
| current, JSON | `v1/data/<cadence>.json` | `public, max-age=60` for `live`, `public, max-age=3600` for the other four | `application/json; charset=utf-8` |
| current, CSV | `v1/data/<cadence>.csv` | same as its JSON | `text/csv; charset=utf-8` |
| archive, JSON | `v1/data/archive/<cadence>/<period>.json` | `public, max-age=31536000, immutable` | `application/json; charset=utf-8` |
| archive, CSV | `v1/data/archive/<cadence>/<period>.csv` | `public, max-age=31536000, immutable` | `text/csv; charset=utf-8` |
| index | `v1/data/index.json` | `public, max-age=300` | `application/json; charset=utf-8` |

A current CSV shares its JSON's `Cache-Control` because it is the same data at the same cadence.
Two values across the ten cadence objects, as `docs/PLAN.md` 3.2 requires, and the CSV does not
add a third.

One run for one cadence therefore writes five objects: current JSON, current CSV, archive JSON,
archive CSV, and the index.

### Excluded measures

Eight ids that must be unpublishable rather than merely unpublished. They appear in
`contract.py` as an explicit exclusion set so that check 2 can name the reason, and they appear
in no registry entry.

| Id | Reason | Source |
|---|---|---|
| `householdsActivelyHomeless` | 1,478 households against 1,263 people, impossible | `docs/FINDINGS.md` |
| `youthLedHouseholds` | 6 households against 135 people, 22.5 each | `docs/FINDINGS.md` |
| `lengthOfStayDistribution` | resolves to a ~2,905 population, not 1,263 | `docs/FINDINGS.md` |
| `jailPrisonRelease7Days` | resolves to a ~5,020 population | `docs/FINDINGS.md` |
| `countyOfOrigin` | nine counties hold exactly one person each | `docs/FINDINGS.md` |
| `clientsOnCqMultipleTimes` | a count of one specific person, an operational data-quality metric with no public meaning | `docs/PLAN.md` 4.5 |
| `cqHouseholds` | reports 1,308 against 1,308 clients on a dashboard that also reports 6 parenting youth households | `docs/PLAN.md` 4.5 |
| `parentingYouthHouseholds` | 6 against a threshold of 5, so suppression would flicker and the withheld weeks would themselves disclose | `docs/PLAN.md` 4.5, brainstorm decision 9c |

`lengthOfStayDistribution` is the excluded Power BI distribution. It is not the 2025 outcomes
figure of 51 average days, which is a separate, sound measure registered as
`averageDaysHomeless`. `docs/PLAN.md` 5.2 calls this trap out; do not conflate them.

## 4. Architecture decisions

### Where this plan supersedes `docs/PLAN.md`

The general rule stands: `docs/PLAN.md` is the design, this plan is the scope, and an unexplained
disagreement is a defect here. Two points are explicit, narrowly scoped exceptions, recorded as
ADR 15 and ADR 16. Each states what `docs/PLAN.md` says, what this plan does instead, and why.
They supersede `docs/PLAN.md` on that specific field and on nothing else, and `docs/PLAN.md` will
be corrected to match after this work lands.

An implementer must not revert either one. Anything not listed in ADR 15 or ADR 16 follows the
general precedence rule.

Two further points where this plan resolves something `docs/PLAN.md` leaves open rather than
contradicting it, listed here so they are not mistaken for silent deviations: ADR 1 (which of two
readings of `docs/HANDOFF.md` constraint 2 the gate implements) and ADR 13 (the live file's
archive period, which `docs/PLAN.md` 4.4 does not name because it predates the fast measure).

### ADR 1: the gate validates, it does not repair

`gate(payload) -> Result` is pure and non-transforming. `Passed` carries the payload it was
given, unchanged and byte-identical to what the sink writes.

`docs/HANDOFF.md` privacy constraint 2 says `MIN_CELL` is enforced in the pipeline, and its
check 6 row reads "applies `MIN_CELL`". Read against the "Fails when" column of the same table
and against `docs/HANDOFF.md`'s definition of done ("a payload with a sub-threshold cell must
fail the run"), the gate's job is to demand that suppression has already been applied and its
residual emitted, not to fold cells itself.

Three reasons this is the right reading:

1. A transforming gate has a third state beyond pass and fail: "changed, and wrote something
   other than what it was given". That defeats decision 7, where a partial pass must be
   unrepresentable.
2. The residual has to come from somewhere real. If an upstream `HAVING count >= 5` already
   dropped rows, the gate cannot invent the residual, and that is the exact live-dashboard bug.
   Requiring the payload to arrive carrying `suppressed: {count, value}` makes the residual
   structurally mandatory instead of something the gate manufactures from what it just refused
   to publish.
3. `docs/HANDOFF.md`'s definition of done requires a sub-threshold cell to fail the run.

Consequence: nothing in this slice folds raw categories. The file source reads fixtures that are
already in published shape. When `sources/looker.py` arrives in phase 7, a pure fold step belongs
on the source side of the gate, in `sources/`, and it is out of scope here. Record that in
`widgets/README.md` so the next reader does not conclude the fold was forgotten.

### ADR 2: the Result type

```text
Failure  frozen dataclass: check (CheckId), path (str), detail (str)
Passed   frozen dataclass: payload (dict). No failures field.
Rejected frozen dataclass: failures (tuple[Failure, ...]). No payload field.
Result   = Passed | Rejected
```

`Rejected` raises in `__post_init__` if `failures` is empty. `Passed` has no `failures`
attribute and `Rejected` has no `payload` attribute, so "publish this bit anyway" cannot be
written: the accessor does not exist. A caller must branch on the type, and neither branch has
the other's data. This satisfies decision 7 without a boolean a later caller could misread.

`Failure.detail` states what was received, not only what was expected, following
`docs/PLAN.md` 9.2. `Failure.path` is a dotted path into the payload
(`breakdowns.raceEthnicity.categories[3].value`).

`Rejected.failures` is ordered by check number, then by path. Ordering is deterministic and
tested, so a test can assert an exact failure list.

### ADR 3: all nine checks run on every payload

Decision 8 requires that a run failing three checks reports three. That is only possible if
every check runs regardless of what earlier checks found, which in turn requires every check to
be **total**: it must return a list of findings for any JSON-representable input, including
`None`, `[]`, `""`, a deeply nested blob, or a dict whose values are the wrong types. A check
that raises on hostile input is a defect, because a crash is an uninformative fail rather than a
named one.

Each check skips substructures it cannot interpret and reports what it can. `gate()` runs all
nine, concatenates, and returns `Passed` only on zero findings.

`gate()` itself does not catch exceptions. Swallowing them would hide defects, and an escaping
exception is fail-closed at the handler: nothing is written, and `app.py` emits `PublishFailed`
and re-raises. Totality is proven by a test corpus, not by a try block.

**This parenthetical used to assert the second half without anyone having run it, and it was
false from Phase 1 until the Phase 4 code review measured it.** `report()` was reached only from
`isinstance(result, Rejected)`, so a run that raised wrote nothing, printed nothing on either
stream, and emitted no metric. `Phase-5.md` Task 3 declares the only alarm this design has on
that metric with `TreatMissingData: notBreaching`, so such a run was silent in every direction
at once: nothing published, nothing logged, alarm green. That is worse than a refusal, because a
refusal tells someone.

Three things reach that path, and all three are now measured rather than reasoned about: a check
that raises, which is this ADR's own case; a gate-approved payload the planner cannot place,
which is `period_for` on a payload carrying no `asOf`; and a sink whose write fails, which is
what a network or an IAM failure will look like once there is a real bucket.
`app.crash_metric` and `app.report_crash` are what make the sentence true, and
`tests/publisher/test_app.py` asserts the metric on the stream the alarm reads for each of the
three. The record of how this survived four phases and three adversarial reviews is in
`feedback.md` under the Phase 4 review.

The lesson is stated here rather than only in the log, because this is the document later phases
inherit from: **a claim in an architecture document that something fails safely is a claim, not a
control, until someone has made it fail and watched.**

### ADR 4: how much structure lives in checks 1 and 4

The nine must stay individually addressable, because each has a test naming it. So there is no
single schema validator. Instead:

- `gate/walk.py` holds the shared traversal: a generator yielding `(path, key, value)` for every
  node, and small helpers for locating measures, series, breakdowns, categories and points.
  Checks 2, 4 and 5 all consume it. This is the DRY part.
- Check 1 owns shape only: top-level keys, the presence and dict-ness of each section, the
  presence of `meta` and its seven keys, and that every section value is a dict. It looks at no
  leaf values. This is what catches an error object returned with HTTP 200, without the gate
  knowing Looker exists.
- Check 4 owns leaf types and domains: integer-ness, non-negativity, enum membership, date
  shapes, and the rejection of formatted strings such as `"1,263"`.

The split is: check 1 asks "is this the right kind of thing", check 4 asks "are its values
legal". Neither absorbs the other and each has its own hostile fixture.

### ADR 5: `bool` is not an integer here

`isinstance(True, int)` is `True` in Python. Every integer domain check must exclude `bool`
explicitly, or `{"value": true}` passes as the integer 1. A hostile fixture covers this.

### ADR 6: the payload declares its own cadence

`meta.cadence` names which of the five files the payload is destined for. Checks 8 and 9 need
to know whether they are looking at `live.json`, and purity forbids reading an environment
variable to find out. The publisher derives the object key from `meta.cadence` (a pure decision,
per decision 13), so the same field drives both the check and the key. A measure whose registry
cadence differs from `meta.cadence` fails check 2.

### ADR 7: the residual must not itself disclose

Check 6 fails when `suppressed.count == 1`, or when `0 < suppressed.value < MIN_CELL`. The same
rule applies to a series `withheld` block.

If exactly one category is suppressed, the residual publishes that category's value exactly, and
suppression has disclosed the cell it exists to hide. If the residual total is below `MIN_CELL`,
the residual is itself a small cell. Either case defeats the control.

This strengthening is not stated in the brainstorm. It follows directly from what check 6 is for,
it costs one extra hostile fixture, and the correct upstream handling is to fold the next
smallest named category in until `count >= 2` and `value >= MIN_CELL`. Flagged here so it can be
vetoed rather than discovered.

### ADR 8: suppression on a series is a withheld point, not a residual

Months are not foldable into "other months", so the categories rule cannot apply. A point below
`MIN_CELL` is emitted as `{"label": "2025-02", "withheld": true}` with no `value` key at all, and
the series carries `withheld: {count, value}` so the total still reconciles. Check 6 has this as
an explicit branch with its own hostile fixtures, per decision 11a and `docs/PLAN.md` 4.5.

A withheld point carrying a `value` key is a check 6 failure whatever the value is. That is the
case where a small cell reached the payload.

`unavailable: true` is a different thing and is not a privacy state. It means the period was
never published (Point-in-Time 2023). It renders as a labelled empty slot. Check 6 ignores it,
check 7 excludes it from sums, and the honesty constraint requires the two never be conflated.

### ADR 9: `universe` must be independently published

A breakdown whose `universe` is defined as the sum of its own categories makes check 7
tautological. So the registry records `universeMeasure`, the id of a separately published figure,
and check 7 asserts the breakdown's `universe` equals that measure's `value` when both appear in
the same payload. That is the direct defence against `docs/FINDINGS.md` section 1, where four
different denominators were presented as one population.

Where no independently published universe exists, the breakdown is not registered. Two real
consequences, both recorded so they read as decisions rather than omissions:

- ALICE owner and renter cost burden are excluded. Their universes (39,554 and 44,026) appear
  nowhere in published material and would have to be summed from the categories, which is
  invention under decision 10.
- The age distribution of unhoused individuals is excluded. It is published only as percentages
  which sum to 99.9, and decision 6 makes reconciliation exact with no tolerance.

### ADR 10: no derived values in a payload

Inflow minus outflow is +219 for everyone and -8 for veterans. Neither is published. Widgets
derive them. This keeps every count a non-negative integer and removes the only place a signed
value would have appeared. The same rule excludes the "14 per 10,000" rate and the "Total Older
Adults and Seniors" tile is kept only because 318 is printed on the dashboard as its own figure
and serves as the `universeMeasure` for the older adults breakdown.

`$3.2M` HUD Continuum of Care funding is excluded. It is published rounded to two significant
figures, `precision` is permanently `exact` per decision 9b, and there is no honest way to carry
a rounded figure in a contract whose only precision value is `exact`.

### ADR 11: the hash excludes `meta.generated`

`docs/HANDOFF.md` requires skipping the PUT when the payload hash is unchanged. `meta.generated`
is a wall-clock timestamp that changes every run, so a hash over the whole document would never
match and the skip would never fire. The hash is sha256 over the payload with `meta.generated`
removed, serialized canonically (sorted keys, `separators=(",", ":")`, `ensure_ascii=False`,
UTF-8). Recorded because this is the kind of thing that looks correct and silently never works.

The stored hash lives in S3 object metadata (`x-amz-meta-payload-hash`) and is read with
`head_object`, so the skip decision costs one HEAD rather than a download.

### ADR 12: `meta` is assembled before the gate, never after

`app.py` reads the clock and `MIN_BUNDLE` from the environment, builds `meta`, and only then
calls `gate()`. Nothing mutates the payload after the gate. The invariant is that the bytes the
sink writes deserialize to exactly `Passed.payload`, and there is a test asserting it. Any
post-gate mutation would defeat the entire design, so it is stated as an invariant rather than
left to care.

### ADR 13: `live.json` is archived daily, `index.json` is not gated

Archive periods per `docs/PLAN.md` 4.4: `annual/2026.json`, `quarterly/2026-Q1.json`,
`monthly/2026-07.json`, `weekly/2026-W31.json`. The live file has no natural period, and
archiving per minute would produce 43,200 objects a month, so its period is the day:
`archive/live/2026-08-01.json`, overwritten within the day. `docs/HANDOFF.md` constraint 7 asks
that every published payload be archived, and S3 versioning holds the intra-day trail privately,
which is the split `docs/PLAN.md` 4.4 describes. The template carries a noncurrent-version
expiry scoped to the live keys only, so the correction history of the slower archives is not
swept up with it.

The archive object is byte-identical to the current object. Same bytes, different key, different
`Cache-Control`. "Same gate, no exceptions" is then true by construction rather than by a second
code path.

`index.json` carries no figures. It lists what exists, per cadence, with each period's as-of date
and `schemaVersion`. It is derived purely from gated payloads and the previous index, so it does
not itself pass through the gate. Stated explicitly because `docs/PLAN.md` 4.4's "same gate, no
exceptions" is about archive data objects.

### ADR 14: where the pure publish decisions live

`publisher/publish.py`, its own module above the sinks, not inside `app.py`. Object keys,
`Cache-Control`, `Content-Type`, the period name, the hash, the unchanged-skip decision, the
`index.json` merge and the CSV rendering are all pure functions of their inputs and are tested
with no AWS and no mocking library. `app.py` is then the only impure module in the publisher:
clock, environment, filesystem, network. `sinks/s3.py` is a handful of lines calling
`put_object` and `head_object` with what it was handed.

### ADR 15: a series point carries `value` and `components`, superseding `docs/PLAN.md`

`docs/PLAN.md` section 3's data contract writes a Point-in-Time point as
`{"label": "2024", "total": 691, "sheltered": 503, "unsheltered": 188}`: the point total under a
key named `total`, and each component as a sibling key at the same level.

This plan writes `{"label": "2024", "value": 691, "components": {"sheltered": 503,
"unsheltered": 188}}`.

Why, and it is not tidiness:

1. **Every count sits under the same key name.** Checks 4, 6 and 7 each walk the payload looking
   for count positions. With `value` everywhere, a count position is one rule. With `total` on a
   point, `value` on a measure and a category, and bare component names as siblings, it is four
   rules and a list of exceptions that grows every time a series gains a component.
2. **The small-cell property test becomes writable.** "Every count position is 0 or at least
   `MIN_CELL`" can only be asserted mechanically if a count position is identifiable without a
   per-measure lookup. Under the `docs/PLAN.md` shape, `sheltered` is a count and `label` is not,
   and telling them apart means consulting the registry for every key at that level.
3. **Components stop colliding with the allowlist.** With components as sibling keys, the point
   allowlist has to admit every component name of every series, so `sheltered` becomes a globally
   allowed key at point level and check 2 can no longer say a component belongs to the series that
   declares it. Nesting them under `components` keeps the point allowlist at five fixed names and
   lets the registry own which component names that series may use.
4. **`total` is already taken.** A reconcilable series carries `total` at series level, meaning
   the sum across points. Using the same word for a point's own sum is the kind of collision that
   produces a correct-looking bug in check 7.

Scope of this supersession: the shape of a series point, and nothing else. `docs/PLAN.md`'s
`measures`, `series` and `breakdowns` sections, its `meta` block, and its `precision` field are
unchanged.

### ADR 16: the suppression block is `suppressed: {count, value}`, superseding `docs/PLAN.md` and `docs/HANDOFF.md`

`docs/HANDOFF.md` privacy constraint 3 and `docs/PLAN.md` section 4 both name the block
`{suppressedCategories, suppressedValue}` as two flat keys. `docs/HANDOFF.md`'s own contract
example already disagrees with its prose and writes `"suppressed": {"count": 0, "value": 0}`, so
the design is not internally consistent on this point and something has to be chosen.

This plan takes the nested form, `suppressed: {count, value}`, for three reasons:

1. It is what the contract example in `docs/HANDOFF.md` shows, and the example is the more
   precise statement of the two.
2. The series case needs the identical shape under a different name (`withheld: {count, value}`).
   With flat keys that is `withheldPoints` and `withheldValue`, two more allowlist entries and a
   second pair of rules in check 6. Nested, it is one shape validated by one function used twice.
3. `residual` is already a nested block with `label` and `value`. A payload where one remainder
   block is nested and the other is two flat keys at the parent level is harder to read and
   harder to walk.

The semantics `docs/HANDOFF.md` constraint 3 specifies are unchanged: suppression must emit its
residual so totals still sum to the universe, and `HAVING count >= 5` remains the bug this
prevents. Only the spelling changes.

Scope of this supersession: the name and nesting of the suppression block, and its series
counterpart. Nothing else.

### ADR 17: `shelterStatus` publishes, and the disputed labels stay inside the residual

`docs/FINDINGS.md:68` records that the shelter status labels cannot all be correct. Four labeled
slices total 1,183 of 1,263, leaving 80 across two unlabeled categories, and if the legend is
size-sorted those two are capped at 66 combined. The audit's conclusion is a disjunction: **either
the legend is not size-sorted, or a label is attached to the wrong slice.**

The decision is to register and publish `shelterStatus`. The reasoning, recorded so it is a
judgement someone made rather than a finding nobody noticed:

- `docs/FINDINGS.md`'s own summary table classifies shelter status as "Readable in part", not as
  one of the five measures that cannot be republished, and its denominator table lists it as
  resolving to 1,263, agreeing with the headline. It is excluded from neither list.
- **The truncation dispute is confined to the residual, and that part is sourced.**
  `docs/FINDINGS.md:27` attributes exactly **two** truncated labels to shelter status, and the
  integrity section finds exactly two categories it cannot name, holding 80 between them. Those
  are the same two. The row immediately above it does the same thing for race and ethnicity
  ("four category labels truncated"), and `docs/HANDOFF.md:349` states that identification
  outright: the residual of 99 is where "four category labels are truncated in the public source
  and cannot be named" go. Same phrasing, same counts, same consequence. So every shelter-status
  category whose label the audit says cannot be read is already inside
  `residual: {"label": "Other or unknown", "value": 113}`, along with the fourth labeled slice
  (33). 33 + 80 = 113, and `site/dashboard.html`'s `unknownNote` records the same fold for the
  same reason.

  The obvious objection is `docs/FINDINGS.md:129`, which cites "Sheltered- No ..." among the
  report's truncated legend labels and looks at first like a truncated label sitting on a named
  category. It is not, and checking it is what confirms the reading above. `docs/FINDINGS.md`'s
  four labeled slices are 720, 322, 108 and 33, and all four are transcribed with clean labels in
  `docs/HANDOFF.md` (which folds the 33 into its "other or unknown 113"). Nothing is left for a
  truncated label to attach to except the two inside the 80. "Sheltered- No ..." is one of those
  two, which is also why a size-sort error or a label swap is plausible here at all.

  Note that `docs/FINDINGS.md` calls them "unlabeled" in the integrity section and "truncated" in
  the summary table. That is loose phrasing for the same thing, "cannot be named", exactly as
  `docs/HANDOFF.md:349` uses both words of the race residual.
- The privacy control holds under every decomposition of that 113. Nobody knows whether either
  unlabeled category is below `MIN_CELL`, and it does not matter: they are unnamed and combined,
  so no small cell is published whichever way the 113 splits.

**The mislabeling horn is unresolved, and this ADR does not claim otherwise.** The argument above
covers only the first horn of `docs/FINDINGS.md:72`, that the legend is not size-sorted. If
instead a label is attached to the wrong slice, nothing in `docs/FINDINGS.md` confines that to the
residual, and `Sheltered` at 720 is not ruled out as the mislabeled one. The audit could not
settle it: `docs/FINDINGS.md:6` records that it had the public embed and published documents only,
and its Confidence section resolves the analogous question about the race and ethnicity labels the
same way, by saying it needs workspace access. Its priority list does not name the shelter-status
labels at all.

So the residual risk being accepted is stated plainly: **publishing three named categories from a
source whose own audit says a label may sit on the wrong slice.** It is accepted because the
denominator reconciles exactly, which is the failure `docs/FINDINGS.md` opens with and the one
check 7 exists to prevent; because the audit did not place this measure among the five it says
cannot be republished; because the risk is to a label rather than to a count, so no small cell is
exposed and no denominator is misstated by it; and because the alternative below is available the
moment anyone shows the horn resolves against a named category.

It is **not** accepted on the basis that the audit does not question those three. That was this
plan's inference presented as the audit's finding, and `docs/FINDINGS.md` does not support it.

Two consequences that are not obvious and that the implementation must carry:

1. `suppressed: {count: 0, value: 0}` is correct here and is not a placeholder. It is a statement
   about what the **publisher** suppressed for `MIN_CELL` reasons, which is nothing. The 113 is a
   `residual`, which means "the source did not name these", a different fact with a different
   field. Conflating the two would be the bug: it would claim small cells were folded when the
   real cause is an unreadable public embed.
2. Check 6 gains one rule: a `residual.value` in 1 to 4 fails, exactly as a named category does. A
   residual is unnamed but it is still a published count, and a residual of 3 is a small cell
   whatever it is called. This costs no new field and closes the gap ADR 7 opens for `suppressed`
   but not for `residual`.

`PROVENANCE.md` records the 33 + 80 decomposition, cites `docs/FINDINGS.md` for it, and records
the unresolved mislabeling horn, so the residual's meaning and its residual risk are both written
down where the figures are.

If someone later gets workspace access and the labels resolve, the change is to the fixture and
`PROVENANCE.md`, not to the gate. **A named category is among the things that could change.** Three
outcomes and what each costs: the legend was simply not size-sorted, and nothing changes; a label
inside the residual was misplaced, and the residual's composition changes while the payload does
not; a named category carried the wrong label, and that category's label or the whole measure
changes. The third is why the exclusion alternative below stays live rather than being closed out
here.

The alternative, excluding `shelterStatus` outright, stays available and is a one-line registry
change. It is not taken because it would contradict `docs/FINDINGS.md`'s own classification and
would drop a widget `docs/PLAN.md` 5.2 registers.

## 5. Testing strategy

### The bar

From `docs/HANDOFF.md`'s working style, and it is the bar this component is judged against:

- A test asserting the gate returned a failure is **not enough**. Each hostile fixture asserts
  **which** check fired and that **no payload was produced**.
- The assertion is over the **exact set** of check ids that fired, not just membership. Several
  hostile fixtures legitimately trip two checks. Writing the exact set down forces the author to
  know which, and turns an accidental extra failure into a red test.
- No test may assert that the gate works because the code looks right.

### Test layout

`widgets/tests/gate/test_check_N_<name>.py`, one module per check, plus:

| Module | What it proves |
|---|---|
| `test_valid_fixtures.py` | every valid fixture returns `Passed`, and its payload is unchanged |
| `test_no_small_cell_reaches_the_payload.py` | across all valid fixtures, every count position is either 0 or at least `MIN_CELL`, and no `withheld` point carries a `value` key |
| `test_exclusions.py` | parameterized over all eight excluded ids: injecting each into an otherwise-valid payload fires check 2 |
| `test_totality.py` | every registered check, run over a fixed corpus of about 30 malformed inputs, returns a list and raises nothing |
| `test_result_type.py` | `Rejected` with no failures raises, `Passed` has no failures attribute, `Rejected` has no payload attribute, ordering is deterministic |
| `test_provenance.py` | every count in every valid fixture appears in `fixtures/PROVENANCE.md` |
| `test_purity.py` | AST source assertion: nothing under `gate/` imports `os`, `time`, `datetime`, `random`, `secrets`, `boto3`, `urllib`, `pathlib`, `socket`, `subprocess` or `pytest` |

The purity ban list is exactly those eleven module names. Phase 1 Task 8 restates it and the two
must not drift; Task 8's is the actionable copy. From Phase 5 the ban extends to `yaml` across the
whole `publisher/` tree.

`test_provenance.py` is what makes decision 10 executable rather than a promise. It parses the
value column of `PROVENANCE.md` into a set and asserts every count-position integer in every
valid fixture is a member. A figure nobody can source fails the suite.

`test_purity.py` is what makes decision 3 executable. Purity by inspection rots; purity asserted
by a test does not.

The totality corpus is a fixed, hand-written list. It uses no random seed, so a failure is
reproducible from the test file alone. It covers the checks **registered in the check list**, not
every function in `checks.py`. Until Phase 3 the unimplemented checks may exist as stubs, and a
stub returning an empty list would pass the totality corpus trivially and report coverage it does
not have. Introspect the registered list, not the module.

### One deliberate exception to the exact-set rule

`test_exclusions.py` asserts membership rather than an exact set, and that is considered rather
than a slip. It injects an excluded id into an otherwise-valid payload, and in Phase 1 the only
valid payload is `live.json`, so the injected id necessarily makes the live file carry two
measures and trips check 8 as well. The exact set therefore depends on which fixture the
parameterization happens to start from, which would make the test about the fixture rather than
about the exclusion. Every other hostile test asserts an exact set.

### Running it

```bash
cd widgets && uv run --with pytest --no-project pytest -q
```

From Phase 5 the command gains a development-only `pyyaml`, used by the template test and
unreachable from `publisher/`:

```bash
cd widgets && uv run --with pytest --with pyyaml --no-project pytest -q
```

No network, no AWS, no Docker. The suite must pass with the machine offline.

### Verification that needs Docker

`sam local invoke` pulls `public.ecr.aws/lambda/python:3.13-x86_64` on first use, which is not
present in this environment yet and is a few hundred megabytes. That is a one-time cost in
Phase 5. The daemon is running and reachable; `public.ecr.aws/sam/build-python3.13` is already
cached locally, which is the build image and not the one `sam local invoke` needs.

Phase 5 also provides a Docker-free end-to-end path (`python3 publisher/app.py <fixture>`), so a
failed image pull blocks the SAM verification only, not the phase.

## 6. Verified in this environment

Recorded so no later phase re-derives them, and so a wrong one is visible rather than assumed.

| Claim | Command | Result |
|---|---|---|
| SAM CLI present | `sam --version` | 1.158.0 (1.165.0 available) |
| `sam validate --lint` needs no credentials | `sam validate --lint` on a minimal SAM template in a scratch dir | "is a valid SAM Template", exit 0, with and without `--region us-east-1` |
| cfn-lint reachable without installing | `uvx cfn-lint --version` | cfn-lint 1.53.3 |
| pytest reachable without installing | `uv run --with pytest --no-project pytest --version` | pytest 9.1.1 |
| Docker daemon up | `docker info` | Server Version 29.4.0 |
| Python | `python3 --version` | 3.13.13 |
| Repo is a git repo | `git log --oneline`, `git branch --show-current` | 14 commits, branch `main`, clean tree |

`cfn-lint` is not on PATH as a bare command. Any acceptance criterion naming it must invoke
`uvx cfn-lint`.

## 7. The nine checks

Ordered cheapest and most structural first. Phase assignment in the last column.

| # | Id | Fails when | Phase |
|---|---|---|---|
| 1 | `check_1_payload_shape` | not a dict, unknown or missing top-level key, `meta` missing a required key, a section that is not a dict of dicts | 1 |
| 2 | `check_2_field_allowlist` | any key not in the structural allowlist at its level; any measure id not in the registry; any id in the exclusion set; any id whose **registry** cadence differs from `meta.cadence`; any segment or component name the registry does not declare for that id | 1 |
| 3 | `check_3_cardinality` | any count over its ceiling in section 3 | 2 |
| 4 | `check_4_type_and_domain` | a count that is not a non-negative `int` (and `bool` is not an `int` here), a formatted string such as `"1,263"`, a percent outside 0 to 100 or not an integer, a `precision` other than the registered value, an object's own `cadence` **field** that is not one of the five names or does not equal `meta.cadence`, a malformed `asOf` or `generated` | 2 |
| 5 | `check_5_pii_scan` | an id-shaped, email-shaped, phone-shaped, SSN-shaped, UUID-shaped or date-of-birth-shaped key or value; a label over `MAX_LABEL_CHARS`; a label outside the permitted character class | 2 |
| 6 | `check_6_suppression` | a named category, measure, point or `residual` value in 1 to 4; a missing or inconsistent `suppressed` block; `suppressed.count == 1`; `0 < suppressed.value < MIN_CELL`; a withheld point carrying a `value`; a series with sub-threshold points folded into a residual instead of withheld; the same rules on a series `withheld` block | 3 |
| 7 | `check_7_reconciliation` | categories plus residual plus suppressed does not equal `universe` exactly; a breakdown `universe` that does not equal its registered `universeMeasure` present in the same payload; a reconcilable series whose published points plus `withheld.value` does not equal `total`; a point whose `components` do not sum to its `value` | 3 |
| 8 | `check_8_single_fast_measure` | `meta.cadence == "live"` and the payload holds more than one entry across all sections, or holds an entry that is not the registered live measure, or gives the live measure a `segments` key | 1 |
| 9 | `check_9_population_floor` | `meta.cadence == "live"` and the live measure's `value`, which is its own universe, is below `LIVE_POPULATION_FLOOR` | 1 |

Checks 1, 2, 8 and 9 land in Phase 1 because they are the four that make `live.json` safe, and
`live.json` is the walking skeleton.

### Which check owns the cadence rule

Two different questions, one word. Splitting them is what keeps the expected failing sets stable
from Phase 2 onward.

- **Check 2 owns the registry question**: does this id belong in this file at all? It compares the
  registry's cadence for that id against `meta.cadence` and never looks at the object's own
  `cadence` field.
- **Check 4 owns the field question**: is the `cadence` value written on this object a legal one,
  and does it agree with `meta.cadence`? It is a value-domain rule like any other and never
  consults the registry.

A payload object can fail either alone. `veteransOnCq` in `live.json` with its own field written
as `"live"` fails check 2 only, because the value is internally consistent and the registry is
what it contradicts. The same object with its field written as `"weekly"` fails check 2 and
check 4. Section 8's expected sets assume the first form, and section 8 says so per fixture.

## 8. The hostile fixture inventory

Twenty-one files plus one parameterized test over the eight exclusions. Every one asserts the
exact set of check ids that fired and that no payload was produced. Hostile fixtures are
fabricated and should obviously be so.

| File | Target | Expected failing checks | Phase |
|---|---|---|---|
| `01-shape-looker-error.json` | 1 | {1} | 1 |
| `02-allowlist-client-id.json` | 2 | {2, 5} | 1 |
| `03-cardinality-row-explosion.json` | 3 | {3} | 2 |
| `04-type-formatted-string.json` | 4 | {4} | 2 |
| `05-pii-email-in-label.json` | 5 | {5} | 2 |
| `06-suppression-named-small-cell.json` | 6 | {6, 7} | 3 |
| `07-reconciliation-off-by-one.json` | 7 | {7} | 3 |
| `08-live-second-measure.json` | 8 | {2, 8} | 1 |
| `09-live-population-floor.json` | 9 | {9} | 1 |
| `10-live-segmented.json` | 8 and the registry | {2, 8} | 1 |
| `11-parenting-youth-households.json` | 2, exclusion | {2} | 3 |
| `12-clients-on-cq-multiple-times.json` | 2, exclusion | {2, 5, 8} | 1 |
| `13-series-small-point-folded.json` | 6, series branch | {2, 6} | 3 |
| `14-suppressed-residual-discloses.json` | 6, ADR 7 | {6} | 3 |
| `15-segment-not-registered.json` | 2, decision 12 | {2} | 2 |
| `16-cq-households.json` | 2, exclusion | {2} | 3 |
| `17-denominator-mismatch.json` | 7, cross-measure | {7} | 3 |
| `18-precision-rounded.json` | 4, decision 9b | {4} | 2 |
| `19-withheld-point-carries-value.json` | 6 | {2, 6, 7} | 3 |
| `20-bool-as-count.json` | 4, ADR 5 | {4} | 2 |
| `21-series-carrying-segments.json` | 2, structural | {2} | 2 |

`15` and `21` are two different attacks and both are needed. `15` gives a registered **measure**
(`inflow`, whose registry entry declares `("veterans",)`) an unregistered segment name
(`chronic`). That is the decision 12 case: a measure asked for a segment it does not carry must
resolve to a stated unavailable rather than silently falling back to `all`, and the registry is
what makes it checkable. `21` gives a **series** (`pitCount`) a `segments` key at all, which the
structural allowlist does not permit at any value and which therefore never reaches the registry.
An earlier draft used `21`'s payload for `15` and would have tested the allowlist twice while
leaving decision 12 untested.

Expected sets are the plan's premise, not its conclusion. Where an implementer measures a
different set, the correct move is to record the measured set with its reason, not to bend the
fixture until it matches this table. Four known interactions, stated so they are not surprises:

- `02` puts a `clientId` key inside a category, which is both an unknown key (2) and id-shaped
  (5). Both firing is the point: the allowlist and the PII scan are independent controls.
- `08`, `10` and `12` are built on `live.json`, and check 8 fires on all three whatever else they
  do. `08` adds a second measure, `12` adds an excluded one, and either way the live file now
  holds more than one entry; `10` gives the live measure a `segments` key. Each is also a registry
  violation (2). `12` is the one exclusion fixture stranded in a phase where `live.json` is the
  only base available, which is why it carries check 8 while `11` and `16`, built on `weekly.json`
  in Phase 3, do not: checks 8 and 9 apply only when `meta.cadence == "live"`.
- `12` reads {2, **5**, 8} rather than {2, 8}. The third element was measured in Phase 2 and this
  table is edited to match rather than the fixture. `clientsOnCqMultipleTimes` contains `client`,
  so the PII scan fires on the id itself, and the scan has no exemption for ids the registry or
  the exclusion set names. An exemption was tried in Phase 2 and removed: for an excluded id it
  suppresses a redundant finding harmlessly, but for a **registered** id check 2 does not fire at
  all, because the id is publishable, and the key scan is then the only control on that name. The
  union was the wrong scope, so there is no exemption. Nothing is lost by reporting both, since
  `Rejected.failures` is ordered by check number and check 2's recorded reason still reads first.
- `06` and `19` break a total as well as a suppression rule, so check 7 fires alongside check 6.
  `13` does not: its `total` is the sum of its two published points, so the fold is refused on
  check 6's own terms and the set stays {2, 6}. An earlier draft of this bullet listed `13` and
  contradicted its own table row; the table is the authority and Phase 3 built the fixture to it.
- `19` reads {2, **6**, 7} rather than {6, 7}. The second element was measured in Phase 3 and this
  table is edited to match rather than the fixture. A point carrying both `withheld` and `value`
  breaks the point level's exactly-one-of rule, which is check 2's, and there is no way to write
  "a withheld point carrying a value" that does not. Three independent controls therefore refuse
  it, measured by removing them one at a time: with check 6's withheld-point rule gone it still
  fails {2, 7}; with the allowlist rule gone as well it still fails {7}; only with check 7's
  series total rule gone too does it publish.
- Every fixture that puts an id into a file its registry cadence does not name writes that id's
  own `cadence` field as the file's cadence, so check 4 does not fire and the failure is
  attributable to the registry rather than to a typo. This applies to `08`, `11`, `12` and `16`.
  `10` adds no foreign id, only an unregistered segment on the live measure, whose own `cadence`
  field is `"live"` already. See section 7, "Which check owns the cadence rule".

## 9. The valid fixtures

One per cadence file. Every figure is transcribed, none is modelled or estimated. Arithmetic
verified while planning; the implementer re-verifies rather than trusting this table.

### `live.json`

`queueTotal` 1308, the Community Queue total alone. No segments, ever. Universe 1308, well above
the floor of 100.

### `weekly.json`

`chronicallyHomelessOnCq` 532, `unaccompaniedYouthOnCq` 71, `veteransOnCq` 28,
`totalOlderAdultsAndSeniorsOnCq` 318, `averageDaysOnCq` 173 (kind `average`), and breakdown
`olderAdultsOnCq` with universe 318 and categories 181 (55 to 61) and 137 (62 and over).
181 + 137 = 318 exactly. 28 is fine here: the population floor applies to fast measures only.

### `monthly.json`

`cqReferrals`, a 20-point series from December 2024 to July 2026, total 1318, with February 2025,
March 2025 and April 2025 withheld and `withheld: {count: 3, value: 7}`. Published points sum to
1311; 1311 + 7 = 1318.

The values, read off the bar labels in `docs/reference/community-queue-overview.png`:

```text
81, 10, 2, 2, 3, 38, 35, 15, 23, 7, 58, 45, 71, 49, 72, 117, 160, 147, 177, 206
```

The month mapping is derived from the axis labels, which appear on every second bar: "January
'25" sits under bar 2, "March" under bar 4, and "July" under bar 20. That places bar 1 at
December 2024 and bar 20 at July 2026. The plan reviewer re-read the image independently and
confirmed both the twenty values and this alignment, so it is corroborated rather than assumed.
Phase 3 Task 5 still requires the implementer to open the image and confirm it before writing the
fixture: two readings agreeing is the standard this project holds transcriptions to, and a third
costs a minute. The three sub-threshold values (2, 2, 3) match `docs/PLAN.md` 4.5's "roughly 2, 2
and 3 in early 2025".

### `quarterly.json`

The HMIS active snapshot, 1 January to 31 March 2026. `activelyHomeless` 1263,
`personsInFamilyHouseholds` 197, `personsInYouthHouseholds` 135, `familyHouseholds` 59.

Breakdown `raceEthnicity`, universe 1263, `minCell` 5: White 679, Black or African American 343,
Multi-racial 142, `residual: {"label": "All other categories", "value": 99}`,
`suppressed: {"count": 0, "value": 0}`. 679 + 343 + 142 + 99 = 1263.

Breakdown `shelterStatus`, universe 1263, `minCell` 5: Sheltered 720, Unsheltered 322, Doubled up
or couch surfing 108, `residual: {"label": "Other or unknown", "value": 113}`,
`suppressed: {"count": 0, "value": 0}`. 720 + 322 + 108 + 113 = 1263.

`suppressed` is required on every breakdown by the allowlist, so it appears on both, and
`{count: 0, value: 0}` is a statement of fact rather than a placeholder: the publisher suppressed
nothing. Both residuals exist because labels are unreadable in the public source, which is a
different fact carried by a different field.

`shelterStatus` carries a `docs/FINDINGS.md` integrity finding and publishes anyway. **Read ADR 17
before writing this fixture, including the half that is unresolved.** In short: the 113 decomposes
as the fourth labeled slice (33) plus the two categories the audit cannot name (80), and the
truncation half of the audit's finding is confined to that residual. The mislabeling half is not
confined and is not settled, so a named category could still turn out to carry the wrong label.
`PROVENANCE.md` records the 33 + 80 decomposition, cites `docs/FINDINGS.md` for it, and records
the unresolved half.

### `annual.json`

- `pitCount` series: 2022 690, 2023 unavailable, 2024 691 (503 sheltered, 188 unsheltered), 2025
  736 (541, 195), 2026 859 (637, 222). Components sum to their point totals exactly. Not
  reconcilable across years, so no `total`.
- `newlyHomelessHouseholds` series: 2020 841, 2021 1086, 2022 1649, 2023 1430, 2024 1742, 2025
  2077.
- `inflow` 3577 with segment `veterans` 197. `outflow` 3358 with segment `veterans` 205. No net.
- `peopleServed` 5082, `servicesDelivered` 84079, `positiveHousingExits` 1360,
  `peopleReviewedAtCaseConferencing` 565.
- `housingRetentionTwoYears` 82 (kind `percent`). `averageDaysHomeless` 51 and
  `nationalAverageDaysHomeless` 176 (kind `average`).
- `disablingConditionAtIntake` series: 2023 54, 2024 49, 2025 45 (kind `percent`, not
  reconcilable).
- `aliceHouseholdsBelowThreshold` 80224, `aliceHouseholdsAboveThreshold` 130892,
  `medianHouseholdIncome` 70833, `survivalBudgetFamilyOfFour` 76512,
  `stabilityBudgetFamilyOfFour` 128124 (kind `currency`). Breakdown `aliceThreshold`, universe
  80224, `minCell` 5: Poverty 27445, ALICE 52779, no `residual`,
  `suppressed: {"count": 0, "value": 0}`. 27445 + 52779 = 80224.

`aliceThreshold` carries no `residual` at all, and neither does the weekly `olderAdultsOnCq`
above, where 181 + 137 = 318 leaves nothing over. `residual` is the only optional key on a
breakdown, because in both cases the categories are exhaustive and named. `suppressed` is still
required on both and is still `{count: 0, value: 0}`. An earlier draft of this paragraph called
`aliceThreshold` the one breakdown with no residual, which was true when only three cadence files
existed and is superseded by this section's own weekly description.

Deliberately absent, each for a reason recorded above: ALICE owner and renter cost burden
(ADR 9), the age distribution (ADR 9), HUD CoC funding (ADR 10), inflow and outflow net
(ADR 10), and all eight excluded ids.
