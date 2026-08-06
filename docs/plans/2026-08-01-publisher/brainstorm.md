# Feature: The publisher

## Overview

This is **phases 0, 1 and the authoring half of phase 2** of a larger platform. The full design
lives at `docs/PLAN.md` and should be read before planning; this document scopes a slice out of it
and does not restate its reasoning. Where this document and `docs/PLAN.md` appear to disagree,
`docs/PLAN.md` is the design and this is the scope.

The platform publishes the Coalition to End Homelessness's public HMIS figures as JSON on a CDN,
rendered by an embeddable widget bundle. The publisher is the write half: it takes a candidate
payload, runs it through a gate, and writes the survivors to S3. The gate is the point of the
system. The source is HMIS data, client-level records are PII, and the gate is the only thing
standing between a changed Looker query and client-level data on a public CDN. Everything
downstream assumes it works and has no independent defence if it does not.

What this slice builds: the field contract, fixtures from real published figures, the gate as a
pure library, the handler and adapters that wire it together, and the SAM template describing the
bucket, distribution, function and schedule. It must run end to end locally, from a file source to
a printed payload, with no AWS account.

**The one thing it does not do is deploy.** `sam deploy` is run by a human against the `dev` SSO
profile. Authoring infrastructure and standing it up are different activities with different risk,
and a CloudFront distribution takes ten to fifteen minutes to converge, which is not a loop worth
automating. Everything here is verifiable without credentials: `sam validate --lint`, `cfn-lint`,
and `sam local invoke` against a fixture.

## Decisions

1. **Python 3.13**, matching the Lambda runtime.
2. **Nothing in `requirements.txt`.** `boto3` is provided by the managed Python runtime and may be
   imported without packaging it. Caveat worth respecting: AWS does not pin the runtime's `boto3`
   version, so do not depend on recent API surface. Everything else is standard library.
   `docs/HANDOFF.md` specifies stdlib `urllib` rather than the Looker SDK for the same reason, and
   that is phase 7. `pytest` is development-only and must not be reachable from `gate/`.
3. **The gate is pure.** `gate(payload) -> Result`, no I/O, no network, no clock, no randomness,
   no environment reads. This is what makes the adversarial tests impossible to fake, and it is
   why the transport is an adapter rather than part of the job. See `docs/PLAN.md` §3.3.
4. **Nine checks, in a fixed order**, cheapest and most structural first. Enumerated below and in
   `docs/PLAN.md` §4.
5. **`MIN_CELL = 5`, and suppression must emit its residual.** `HAVING count >= 5` silently drops
   rows and breaks reconciliation, which is the exact bug found in the live dashboard. See
   `docs/HANDOFF.md` privacy constraints 2 and 3.
6. **Reconciliation is exact, no tolerance.** Named plus residual plus suppressed equals the
   universe. `docs/FINDINGS.md` §1 documents four different denominators presented as one
   population in the live report; that is what this check makes impossible.
7. **Fail closed, and make a partial pass unrepresentable.** Any check failing means no write.
   `Result` should be a type where "publish this bit anyway" cannot be expressed, rather than a
   boolean a later caller could misread. See `docs/HANDOFF.md` constraint 6.
8. **Collect every failure, publish on none.** A run failing three checks reports three. The
   publish decision stays binary regardless of how many fired.
9. **The fast measure is real and it is the Community Queue total, alone.** See
   `docs/PLAN.md` §4.5, which is the privacy analysis of
   `docs/reference/community-queue-overview.png` and is required reading before touching the
   registry. In short: `live.json` carries `queueTotal` (1,308) and **nothing else, with no
   segments, ever**. The CQ's veteran count is 28, its parenting-youth-household count is 6, and
   its "on a CQ multiple times" count is 1, all of which are below the floor or below `MIN_CELL`
   or both. Those segments move to `weekly.json`; "multiple times" and parenting youth households
   are excluded entirely, per decisions 11 and 9c. Checks 8 and 9 are now guarding something that exists rather than something
   hypothetical.
9a. **Five cadence files.** `live`, `weekly`, `monthly`, `quarterly`, `annual`. The CQ segments are
   weekly and its referrals series is monthly. Two `Cache-Control` values across all of them: 60
   seconds on `live`, an hour on everything else. See `docs/PLAN.md` §3.2.
9b. **No rounding. `precision` is permanently `exact`.** The field stays in the contract because
   it is the guard that stops a future rounding switch presenting a rounded figure as exact,
   which `docs/HANDOFF.md` calls out explicitly. See `docs/PLAN.md` §4.5.
9c. **A measure that can cross `MIN_CELL` under normal variation must not be registered at all.**
   Parenting youth households is 6 against a threshold of 5, so a weekly series of it reads
   `6, 6, 5, [withheld], 5` and the withheld week discloses "four or fewer". Suppression that
   flickers is a flag on the weeks that matter most. This is a rule the contract enforces by
   omission, and it is why that measure joins the exclusions in decision 11.
10. **Fixtures use only real published figures.** `docs/HANDOFF.md` has a section titled "The real
    data" holding every figure transcribed from Coalition material. Nothing in the valid fixtures
    may be modelled, estimated or invented. Hostile fixtures are fabricated and should obviously
    be so.
11. **Excluded measures must be unpublishable, not merely unpublished.** `docs/FINDINGS.md` lists
    five that do not reconcile: households actively homeless, youth-led households, length of
    stay, jail/prison release, county of origin. Add three from `docs/PLAN.md` §4.5: **clients
    currently on a CQ multiple times**, which is a count of one specific person and an operational
    data-quality metric with no public meaning; **CQ households**, which reports 1,308 against
    1,308 clients on a dashboard that also reports 6 parenting youth households and therefore
    cannot be right; and **parenting youth households**, per decision 9c. Eight exclusions,
    covering three distinct reasons: does not reconcile, has no public meaning, and cannot be
    suppressed without the suppression itself disclosing. The contract must not contain any, and a
    hostile
    fixture introducing one must fail on the allowlist.
11a. **Suppression on a time series is a distinct case from suppression on categories.** The CQ
    referrals series has three months below `MIN_CELL`. Folding them into an unnamed residual is
    impossible because months are not foldable into "other months". The handling is a **withheld
    point**, labelled, with the residual carried in the series metadata so the total still
    reconciles. Check 6 needs this as an explicit branch, with its own hostile fixture, rather
    than improvising when it meets a series. `docs/PLAN.md` §4.5 has the reasoning and the
    counter-argument.
12. **The measure registry records which segments each measure actually has.** Segments are
    sparse: inflow and outflow have a veterans split, household counts have families and youth,
    the Point-in-Time series has none. A measure asked for a segment it does not carry must
    resolve to a stated unavailable rather than silently falling back to `all`, because a silent
    fallback labels an all-population figure as a veterans figure. The registry is where that
    becomes checkable rather than a per-widget accident later.
13. **The decisions live in pure code; `boto3` is a dumb last mile.** Which object to write, its
    key, its `Cache-Control`, its `Content-Type`, whether the hash is unchanged and the PUT should
    be skipped, and the archive's period-based name: all pure and tested. `sinks/s3.py` is then a
    handful of lines calling `put_object` with what it was handed. This is what makes the sink
    testable with no AWS and no mocking library, and it is the same move as decision 3.
14. **A `stdout` sink exists and is the local default.** `sam local invoke` with the file source
    and the stdout sink is the end-to-end run that needs no credentials.
15. **Deploy is human.** The template is authored and validated here. `sam deploy` is not run by
    an agent.

## Scope: In

### The gate, phases 0 and 1

- `widgets/publisher/gate/contract.py` — field allowlist, measure registry (name, cadence file,
  precision, published span, available segments per decision 12), and the excluded-measure list
  from `docs/FINDINGS.md`.
- `widgets/publisher/gate/checks.py` — one pure function per check:

  | # | Check | Fails when |
  |---|---|---|
  | 1 | Payload shape | Not a well-formed object of the expected top-level shape. In the eventual Looker path this is what catches an error object returned with HTTP 200, without the gate knowing Looker exists. |
  | 2 | Field allowlist | Any field name is not in `contract.py`. Unknown field is a fail, not a warning. |
  | 3 | Cardinality | Row or category count over the configured ceiling |
  | 4 | Type and domain | A value is not a non-negative integer, or is a formatted string such as `"1,263"` |
  | 5 | PII scan | Anything ID-shaped, email-shaped, date-of-birth-shaped, or a free-text column |
  | 6 | Suppression | `MIN_CELL = 5` applied and `{ suppressedCategories, suppressedValue }` emitted |
  | 7 | Reconciliation | Named plus residual plus suppressed does not equal the universe exactly |
  | 8 | Single fast measure | A cadence file that may hold one measure would carry more |
  | 9 | Population floor | A fast measure whose universe is under 100 |

- `widgets/publisher/gate/__init__.py` — `gate(payload) -> Result` and the `Result` type.
- `widgets/fixtures/` — a valid payload per cadence file from the real transcribed figures, plus
  **at least twelve hostile payloads**, each written to defeat a specific check. One per check,
  and three that are now concrete rather than hypothetical because the Community Queue exists:

  | Hostile fixture | Must fail on |
  |---|---|
  | A second measure added to `live.json` | 8, single fast measure |
  | The live measure carrying a `veterans` segment | 8 and the registry, per decision 12 |
  | A live measure whose universe is 28 | 9, population floor |
  | `parentingYouthHouseholds` at 6, registered weekly | 2, allowlist, per decision 9c |
  | A time series with a sub-`MIN_CELL` point folded into a residual instead of withheld | 6, per decision 11a |
  | `clientsOnCqMultipleTimes` reintroduced | 2, allowlist, per decision 11 |

- `widgets/tests/gate/` — one test per hostile fixture asserting **which check fired** and that
  **no payload was produced**, plus tests that the valid fixtures pass and reconcile exactly.

### The publisher, phase 2 authoring

- `widgets/publisher/app.py` — the handler. Source, gate, hash, sink, archive. Thin. Writes
  `meta.minBundle` from a Lambda environment variable, per `docs/PLAN.md` §5.10. One integer, read
  once, passed through. Nothing else in the publisher knows what a bundle is.
- `widgets/publisher/sources/file.py` — read a fixture from disk. The only source in this slice.
- `widgets/publisher/sinks/stdout.py` — print. The local default.
- `widgets/publisher/sinks/s3.py` — the last mile only, per decision 13.
- The pure publish decisions, module placement open: object keys, per-file `Cache-Control` and
  `Content-Type` from `docs/PLAN.md` §3.2, the unchanged-hash skip, the archive's period-based
  naming and the `index.json` shape from §4.4, and the CSV rendering. All tested without AWS.
- `widgets/template.yaml` — the SAM template. Every resource and every constraint on it is in
  `docs/PLAN.md` §2, which is a table where each row matters: bucket private with versioning,
  distribution with the three cache behaviours, OAC rather than the legacy OAI, a cache policy
  with MinTTL 0 so origin `Cache-Control` wins and nothing in the cache key, a response headers
  policy carrying CORS **without** forwarding `Origin`, the function, a `ScheduleV2` event
  shipping `State: DISABLED` with the expression as a template parameter, and `DeletionPolicy:
  Retain` plus `UpdateReplacePolicy: Retain` on the distribution and the bucket. §2 explains why
  none of those is optional.
- `widgets/samconfig.toml` — profile `dev`, region `us-east-1`.
- `widgets/README.md` — this slice, how to run the tests, how to run it locally, and the deploy
  command for a human.

### Verification available without an account

- `sam validate --lint` and `cfn-lint` clean.
- `sam local invoke` with the file source and stdout sink, producing a valid payload.
- The same with each hostile fixture, producing no payload and a named failure.

## Scope: Out

Stated at length because the design covers seven phases and three are in scope.

- **`sam deploy`.** Authoring only. A human deploys.
- **Anything from the CQ dashboard beyond what `docs/PLAN.md` §4.5 permits.** The segments are
  quarterly, the referrals are monthly, `live.json` is the total alone, and two measures are
  excluded outright. §4.5 is the specification for this, not a discussion of it.
- **The two unresolved CQ questions.** The households-against-clients contradiction and the
  time-series suppression call are recorded in §4.5. Build the withheld-point branch; do not
  publish a CQ households figure at all until it reconciles.
- **No Looker.** No `sources/looker.py`, no HTTP, no Secrets Manager wiring. Phase 7. The template
  may declare the secret resource; nothing reads it.
- **No JavaScript.** Nothing under `widgets/embed/`. No widgets, no bundle, no `build.mjs`. Phases
  3 to 5.
- **No docs site, no `widgets.json`, no `llms-full.txt`.** Phase 6.
- **No alarm wiring beyond the resource.** The `PublishFailed` metric is emitted and the alarm is
  declared. No notification target is built.
- **Do not modify** `site/`, `powerbi/`, `amplify.yml`, the root `README.md`, or anything in
  `docs/` outside `docs/plans/`. `site/` is deployed and `docs/` is the established design record.

## Open Questions

None blocking. Three the planner should settle and record its reasoning for:

1. **Schema validation approach.** Standard library only, so no `jsonschema`. A structural checker
   driven by `contract.py` is the obvious route, but decide how much of checks 1 and 4 it absorbs
   against how much stays in `checks.py` as separately named functions. The constraint that
   matters: each of the nine must remain individually addressable, because each has a test naming
   it.
2. **`Result` shape.** Decision 8 fixes the behaviour. The concrete type is the planner's call,
   provided a partial pass is not representable.
3. **Where the pure publish decisions live.** Above the sink per decision 13, but whether that is
   its own module or part of the handler is open.

## Relevant Codebase Context

No Python and no infrastructure code exists in this repository yet. There are no conventions to
follow, so establish them.

| File | Why it matters |
|---|---|
| `docs/PLAN.md` | The full design. §2 for the template, §3.2 for the cadence files and their cache headers, §3.3 for the source and sink factoring, §4 for the gate, §4.4 for the archive and `index.json`. Read before planning. |
| `docs/HANDOFF.md` | The brief. The privacy constraints, "The real data" for fixture values, and the working style. |
| `docs/FINDINGS.md` | The audit of the live dashboard. Why five measures are excluded, and the denominator failure check 7 prevents. |
| `site/dashboard.html` | A working `suppress()` and `MIN_CELL` in JavaScript. Prior art for the suppression semantics, not for the code. |
| `docs/reference/community-queue-overview.png` | The fast measure's source dashboard. Its figures are fixture values. `docs/PLAN.md` §4.5 is the analysis of what may and may not come off it. |

Git history is design only. Nothing has been implemented.

## Technical Constraints

- **Nothing in `requirements.txt`.** `boto3` from the runtime, standard library for everything
  else, `pytest` development-only and unreachable from `gate/`.
- **Purity is a hard requirement, not a style preference.** No clock, no network, no filesystem,
  no randomness, no environment reads anywhere under `gate/`. If a check appears to need one, the
  design is wrong. The same applies to the publish decisions in decision 13.
- **`us-east-1`, no custom domain, AWS CLI profile `dev` (SSO).**
- **The verification bar, from `docs/HANDOFF.md`'s working style.** Do not report that the gate
  works because the code looks right. A test asserting the gate returned a failure is not enough:
  each hostile fixture must assert **which** check fired and that **no payload** was produced. The
  user has been burned by plausible-looking work that was wrong, and this is the component where
  that would cost the most.
- Prose style for comments, docstrings and documentation: no em dashes, no filler, no emoji.
  Direct and factual.
