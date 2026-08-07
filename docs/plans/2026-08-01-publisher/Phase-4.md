# Phase 4: the publish decisions, the archive, and the last mile

## Phase goal

Turn one gated payload into the complete set of objects a run writes. That is five: the current
cadence file and its CSV, the archive period and its CSV, and the updated `index.json`, each with
the right key, the right `Cache-Control` and the right `Content-Type`, and none of them written
when nothing changed.
Every one of those decisions is pure and tested without AWS. `sinks/s3.py` is then a handful of
lines calling `put_object` with what it was handed.

Success criteria: `publish.py` decides every object a run produces, tested with no AWS and no
mocking library; the stdout sink prints the full write plan; `sinks/s3.py` contains no policy.

Estimated tokens: `~75000`

## Prerequisites

- Phase 3 complete. All nine checks live, five valid fixtures publishing.
- Read [Phase-0.md](Phase-0.md) ADRs 11, 12, 13 and 14.
- Read `docs/PLAN.md` sections 3.2 (the cadence files and their cache headers) and 4.4 (the
  archive, `index.json`, and why the archive is public).
- No AWS credentials. Nothing in this phase talks to AWS.

## Tasks

> **Task 1: Object keys, cache headers and content types**
>
> **Goal:** The mapping from a payload to where it goes and how it is cached, as pure functions.
> Cadence is two values in this system and nothing else reads it, so these functions are the only
> place the mapping exists.
>
> **Scope:**
>
> * Files: `widgets/publisher/publish.py`, `widgets/tests/publisher/test_publish_keys.py`
> * Content: `object_key`, `archive_key`, `csv_key`, `index_key`, `cache_control`,
>   `content_type`, and a `Write` record carrying key, body bytes, content type and cache control
> * Patterns: the object key table in Phase-0 section 3, which is the complete mapping. It carries
>   `docs/PLAN.md` 3.2's three JSON forms plus the two CSV forms `docs/PLAN.md` names nowhere
> * Out of scope: anything that calls AWS
>
> **Constraints:**
>
> * Keys, headers and content types come from the object key table in Phase-0 section 3, which is
>   the complete list of the five objects a run can write. The three JSON forms are
>   `docs/PLAN.md` 3.2's; the two CSV forms are specified in Phase-0 because `docs/PLAN.md` names
>   them nowhere, and they mirror their JSON siblings: `v1/data/<cadence>.csv` and
>   `v1/data/archive/<cadence>/<period>.csv`
> * Two `Cache-Control` values across the cadence files and nothing else: `max-age=60` on `live`,
>   `max-age=3600` on the other four. A current CSV takes its JSON's value, so the CSV does not
>   introduce a third. `index.json` gets `max-age=300`. Archive objects get
>   `max-age=31536000, immutable`. All are `public`
> * `Content-Type` is `application/json` for JSON and `text/csv` for CSV, both with
>   `charset=utf-8`
> * Pure. No clock, no environment, no filesystem, no network anywhere in `publish.py`
> * `Write` is a frozen dataclass. A caller cannot build a half-formed one
>
> **Acceptance Criteria:**
>
> * [ ] A test asserts the key and both headers for all five object kinds across all five
>       cadences, as a table, so the whole mapping is visible in one place and matches Phase-0
>       section 3 exactly
> * [ ] A test asserts there are exactly two distinct `Cache-Control` values across the five
>       cadence files
> * [ ] `rg -n 'import (os|boto3|urllib|time|datetime|random)' widgets/publisher/publish.py`
>       returns no matches
>
> **Commit Message Template:**
>
> ```text
> feat(publisher): object keys, cache headers and content types as pure functions
>
> - Two Cache-Control values across five cadence files, per PLAN 3.2
> - Archive objects are immutable for a year, the index is five minutes
> - publish.py imports nothing impure
> ```

> **Task 2: The payload hash and the unchanged-write skip**
>
> **Goal:** Skip the PUT when nothing changed. This saves writes, and S3 versioning then gives a
> free change log where every version is a real change rather than a timestamp bump.
>
> **Scope:**
>
> * Files: `widgets/publisher/publish.py`, `widgets/tests/publisher/test_publish_hash.py`
> * Content: `canonical_bytes(payload)`, `payload_hash(payload)`, `should_write(new, current)`
> * Patterns: Phase-0 ADR 11
> * Out of scope: reading the current hash from S3. That is the sink's job in Task 6
>
> **Constraints:**
>
> * The hash covers the payload with `meta.generated` removed. A hash over the whole document
>   changes every run and the skip never fires, which is a defect that looks like working code
> * Canonical serialization is `sort_keys=True`, `separators=(",", ":")`, `ensure_ascii=False`,
>   encoded UTF-8. The same function produces the bytes that are written, so the hash is over what
>   is published
> * `hashlib.sha256`, hex digest. `hashlib` and `json` are the only imports this needs
> * `should_write(new_hash, current_hash)` returns `True` when `current_hash` is `None`. An
>   unknown current state means write, because a missing object is not an unchanged object
>
> **Acceptance Criteria:**
>
> * [ ] A test asserts two payloads differing only in `meta.generated` hash equal
> * [ ] A test asserts two payloads differing in any other field hash differently, including a
>       change of 1263 to 1264
> * [ ] A test asserts key order in the source dict does not change the hash
> * [ ] A test asserts `should_write(h, None) is True`
> * [ ] A test asserts the bytes the hash is computed over are the same bytes a `Write` carries,
>       by comparing them directly
>
> **Commit Message Template:**
>
> ```text
> feat(publisher): payload hash excluding meta.generated
>
> - A hash over the whole document changes every run and the skip would never fire
> - Canonical bytes are the published bytes, so the hash is over what is served
> - An unknown current hash means write, because missing is not unchanged
> ```

> **Task 3: Archive period names**
>
> **Goal:** Periods, not timestamps. `2026-Q1.json` is guessable and means something; a reader can
> construct the URL without reading documentation.
>
> **Scope:**
>
> * Files: `widgets/publisher/publish.py`, `widgets/tests/publisher/test_publish_period.py`
> * Content: `period_name(cadence, as_of) -> str`
> * Patterns: `docs/PLAN.md` 4.4, Phase-0 ADR 13
> * Out of scope: deciding which `asOf` a multi-object payload uses. See the constraint below
>
> **Constraints:**
>
> * `annual` gives `2026`, `quarterly` gives `2026-Q1`, `monthly` gives `2026-07`, `weekly` gives
>   the ISO week `2026-W31`, `live` gives the date `2026-08-01`
> * Derived from the payload's `asOf`, never from the clock. A run replaying an old payload must
>   produce the old period
> * A payload carries several objects with several `asOf` values. The period comes from the
>   latest `asOf` in the payload, and that rule is stated in the docstring and tested. It is not
>   `meta.generated`, which is when the run happened rather than what the data describes
> * ISO week numbers are subtle at year boundaries: 2026-01-01 falls in ISO week 2026-W01, but
>   2027-01-01 falls in 2026-W53. Test the boundary rather than trusting it. `date.isocalendar()`
>   is stdlib and pure, and `publish.py` may import `datetime` (the purity ban applies to `gate/`,
>   not to `publish.py`), provided nothing reads the current time
>
> **Acceptance Criteria:**
>
> * [ ] A test covers all five cadences with a real `asOf` from the matching fixture
> * [ ] A test covers the quarter boundaries: 2026-03-31 gives `2026-Q1` and 2026-04-01 gives
>       `2026-Q2`
> * [ ] A test covers an ISO week that belongs to the previous year, and one that belongs to the
>       next
> * [ ] A test asserts `period_name` never reads the clock, by calling it twice with the same
>       input and asserting equality, and by the absence of `now`, `today` and `utcnow` in the
>       module (`rg -n 'now\(|today\(|utcnow' widgets/publisher/publish.py` returns no matches)
>
> **Commit Message Template:**
>
> ```text
> feat(publisher): archive period names derived from asOf
>
> - Periods, not timestamps: 2026-Q1 is guessable and a timestamped blob is not
> - The period comes from the latest asOf in the payload, not from meta.generated
> - ISO week boundaries are tested rather than assumed
> ```

> **Task 4: `index.json` and the CSV rendering**
>
> **Goal:** An archive people are meant to use is an API, not a folder. `index.json` is the entry
> point, and the CSV roughly doubles who can use the data.
>
> **Scope:**
>
> * Files: `widgets/publisher/publish.py`, `widgets/tests/publisher/test_publish_index.py`,
>   `widgets/tests/publisher/test_publish_csv.py`
> * Content: `index_document(previous_index, payload, period)` and `to_csv(payload)`
> * Patterns: `docs/PLAN.md` 4.4 for the index shape, Phase-0 ADR 13 for why the index is not
>   gated
> * Out of scope: a second index format, a sitemap, an Atom feed
>
> **Constraints:**
>
> * `index_document` is a pure merge over the previous index. It adds this period to its cadence's
>   list, keeps the list sorted and deduplicated, and records each period's `asOf`, its
>   `schemaVersion`, and the JSON and CSV paths. Re-running with the same payload produces an
>   identical index, and a test asserts that idempotence
> * `index.json` carries no figures. A test asserts no count from any valid fixture appears
>   anywhere in a generated index
> * The CSV is deterministic: stable column order, stable row order, `lineterminator="\n"` (the
>   `csv` module defaults to `\r\n`, which would make byte comparison platform-dependent)
> * The CSV carries every published figure with enough context to be read alone: section, id,
>   label, value, `asOf`, cadence, universe where one applies, and a withheld marker. A withheld
>   point appears as a row with an empty value and the marker set, never as a missing row and
>   never as a zero
> * A withheld or suppressed value must not become a number in the CSV. A test asserts no integer
>   between 1 and 4 appears in any value column of any generated CSV
>
> **Acceptance Criteria:**
>
> * [ ] A test asserts `index_document` is idempotent over a repeated run
> * [ ] A test asserts adding a second period keeps both and keeps them sorted
> * [ ] A test asserts no figure from a valid fixture appears in the generated index
> * [ ] A CSV round-trip test reads the generated CSV back with `csv.DictReader` and asserts every
>       published figure is present and equal
> * [ ] A test asserts a withheld point produces a row with an empty value and the marker set
> * [ ] A test asserts the generated CSV bytes are byte-identical across two runs
>
> **Commit Message Template:**
>
> ```text
> feat(publisher): index.json and CSV rendering
>
> - The index is the archive's entry point and carries no figures, so it is not gated
> - The merge is idempotent, so a rerun writes the same bytes
> - A withheld point is an empty CSV cell with a marker, never a zero and never a missing row
> ```

> **Task 5: Compose the write plan**
>
> **Goal:** One function that turns a gated payload plus the current state into the exact list of
> objects to write. Every decision in the publisher above the sink is now in one place and tested
> without AWS.
>
> **Scope:**
>
> * Files: `widgets/publisher/publish.py`, `widgets/tests/publisher/test_publish_plan.py`
> * Content: `plan_writes(payload, previous_index, current_hashes) -> tuple[Write, ...]`
> * Patterns: Phase-0 ADR 13 (archive bytes are identical to current bytes) and ADR 14
> * Out of scope: performing the writes
>
> **Constraints:**
>
> * A run over an unchanged payload plans zero writes, including no index write. An index that
>   updates when nothing changed is a write with no information in it
> * The archive object's body is byte-identical to the current object's body. Same bytes,
>   different key and different `Cache-Control`. This is what makes "same gate, no exceptions"
>   true by construction
> * The plan is ordered and deterministic, so a test can assert the whole tuple
> * `plan_writes` takes the current hashes as an argument. It does not fetch them. Purity is the
>   point
>
> **Acceptance Criteria:**
>
> * [ ] A test asserts a first run for a cadence plans exactly five writes, and asserts the exact
>       keys: `v1/data/<cadence>.json`, `v1/data/<cadence>.csv`,
>       `v1/data/archive/<cadence>/<period>.json`, `v1/data/archive/<cadence>/<period>.csv`, and
>       `v1/data/index.json`. The index is inside the plan, which is what makes the
>       zero-writes-on-unchanged constraint above coherent
> * [ ] A test asserts an unchanged rerun plans zero writes
> * [ ] A test asserts the archive body equals the current body byte for byte
> * [ ] A test asserts the planned bytes deserialize to exactly `Passed.payload`, which is the
>       ADR 12 invariant carried through to the write
> * [ ] A test runs `plan_writes` over all five valid fixtures and asserts every planned key is
>       unique within a run
>
> **Commit Message Template:**
>
> ```text
> feat(publisher): compose the write plan from a gated payload
>
> - An unchanged payload plans zero writes, index included
> - The archive body is byte-identical to the current body, so both passed the same gate
> - The plan is a pure function of the payload, the previous index and the current hashes
> ```

> **Task 6: The S3 sink and the handler wiring**
>
> **Goal:** The last mile. `sinks/s3.py` reads current hashes and writes what it was handed, and
> contains no decision at all.
>
> **Scope:**
>
> * Files: `widgets/publisher/sinks/s3.py`, `widgets/publisher/sinks/stdout.py`,
>   `widgets/publisher/app.py`, `widgets/tests/publisher/test_sinks.py`,
>   `widgets/tests/publisher/test_app.py`
> * Content: a sink interface with `current_hashes()` and `write(writes)`, implemented by both
>   sinks. `app.py` fetches the previous index, plans, and writes
> * Patterns: Phase-0 ADR 14, `docs/PLAN.md` 3.3
> * Out of scope: `sources/looker.py`, Secrets Manager, any retry or backoff policy beyond
>   boto3's default
>
> **Constraints:**
>
> * `sinks/s3.py` contains no key construction, no header value, no hash computation and no skip
>   decision. If a reviewer finds a policy statement in it, the module is wrong
> * The stored hash lives in S3 object metadata as `payload-hash` and is read with `head_object`.
>   A missing object is a missing hash, not an error
> * `boto3` is imported inside `sinks/s3.py` only. Nothing else in the publisher imports it, and a
>   test asserts that. `boto3` comes from the managed runtime and is not packaged, so do not
>   depend on recent API surface
> * The stdout sink prints the write plan as a readable list of key, content type, cache control
>   and byte length, then the payload itself. It reports no current hashes, so a local run always
>   plans a full write
> * Tests for `sinks/s3.py` use a hand-written stub client with recorded calls. No `moto`, no
>   `unittest.mock` patching of boto3 internals, no new dependency
>
> **Acceptance Criteria:**
>
> * [ ] A test asserts `sinks/s3.py` passes each `Write` through to `put_object` with exactly the
>       key, body, `ContentType`, `CacheControl` and metadata it was given, using a stub client
> * [ ] A test asserts a `head_object` raising the client's not-found error yields `None` rather
>       than propagating
> * [ ] `rg -n 'boto3' widgets/publisher/ --files-with-matches` returns only `sinks/s3.py`
> * [ ] `rg -n 'v1/data' widgets/publisher/sinks/s3.py` returns no matches
> * [ ] `cd widgets && python3 publisher/app.py fixtures/valid/quarterly.json` prints the write
>       plan and the payload and exits 0
> * [ ] A rejected run plans and performs zero writes, asserted with a recording sink rather than
>       by reading stdout
>
> **Commit Message Template:**
>
> ```text
> feat(publisher): S3 sink as the last mile, handler wiring
>
> - Every decision is in publish.py; s3.py passes through what it was handed
> - The stored hash is object metadata read with head_object, so the skip costs one HEAD
> - Sink tests use a stub client, so there is no AWS and no mocking library
> ```

## Phase verification

1. Full suite passes offline.
1. All five valid fixtures print a write plan and a payload through `app.py` and exit 0.
1. All twenty-one hostile fixtures exit non-zero, print no payload, and plan zero writes.
1. `rg -n 'boto3' widgets/publisher/ --files-with-matches` returns only `sinks/s3.py`.
1. Break the hash deliberately by including `meta.generated`, watch the unchanged-rerun test fail,
   revert, and record what the broken run reported. This is the defect that would otherwise look
   exactly like working code.

## Integration points

`app.py` now depends on `publish.py` and a sink. `publish.py` depends on nothing but the standard
library. The gate is untouched by this phase and its tests must still pass unchanged.

## Known limitations at the end of this phase

- There is no SAM template, so the S3 sink has no bucket to write to and has never run against
  real S3. It is tested against a stub client only, and that is stated plainly rather than
  reported as "S3 works".
- No Looker source, no Secrets Manager, no schedule.
- The `PublishFailed` metric is emitted but no alarm exists yet.
